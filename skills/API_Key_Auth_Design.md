# ContextWeave API Key 鉴权与风控设计文档

## 一、 设计背景与目标

为了在项目推广期实现**最大化的新用户转化（零配置体验）**，同时在后期能够**有效防止恶意刷量**并**引导用户沉淀（注册专属 Key）**，本系统采用“前端硬编码公共 Key + 后端按需 IP 限流 + Agent 自然语言容错”的分阶段架构设计。

此设计允许在**不强制要求用户更新本地 Skill 脚本**的情况下，纯通过后端更新来收紧策略。

***

## 二、 架构与交互时序

1. **用户**在 IDE (如 Trae/Cursor/Openclaw) 中通过自然语言唤起 ContextWeave Skill。
2. **Skill 脚本**读取本地环境变量 `CONTEXTWEAVE_MCP_API_KEY`。

   * *如果有值*：使用用户的专属 Key。

   * *如果无值*：使用代码中硬编码的“公共体验 Key”。
3. **Skill 脚本**向 **ContextWeave 后端 API** 发起 HTTP 请求，Header 中携带 `Authorization: Bearer <Key>`。
4. **后端 API** 进行鉴权与风控拦截：

   * *如果是专属 Key*：走正常的个人账户配额校验。

   * *如果是公共 Key*：提取请求的 `Client-IP`，进行限流校验。
5. **响应处理**：

   * *未超限*：正常返回 SVG/CW 数据。

   * *超限*：返回 `HTTP 429` 状态码，及包含自然语言引导的 JSON 错误信息。
6. **Agent (大模型)** 收到 HTTP 429 报错，读取其中的自然语言字段，并**原样转述给用户**，完成转化引导。

***

## 三、 详细逻辑设计

### 1. Skill 端（前端）逻辑

Skill 的请求封装代码中，需要实现后备（Fallback）机制：

```python
# 伪代码示例
import os

# 1. 尝试获取用户自己配置的专属 Key
user_api_key = os.environ.get("CONTEXTWEAVE_MCP_API_KEY")

# 2. 如果用户未配置，使用硬编码的公共推广 Key
PUBLIC_TRIAL_KEY = "sk_cw_public_hackathon_trial_202X"
api_key_to_use = user_api_key if user_api_key else PUBLIC_TRIAL_KEY

headers = {
    "Authorization": f"Bearer {api_key_to_use}",
    "Content-Type": "application/json"
}

# 3. 发起请求并透传错误（极其重要：不要过度 catch 错误，让 Agent 看到 HTTP 响应内容）
response = requests.post("https://api.contextweave.com/generate", headers=headers, json=payload)
if response.status_code != 200:
    # 直接将后端的错误信息抛出，Agent 会自动将 error 字段念给用户听
    raise Exception(f"API Error: {response.text}")
```

### 2. Backend 端（后端）逻辑

后端需要在网关层或业务鉴权中间件中，增加对“公共体验 Key”的特判：

```javascript
// 伪代码示例 (Node.js / Express)
const PUBLIC_TRIAL_KEY = "sk_cw_public_hackathon_trial_202X";
const DAILY_LIMIT_PER_IP = 10; // 每个 IP 每天最多允许的体验次数

async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    
    // 分支 A：用户使用的是公共体验 Key
    if (token === PUBLIC_TRIAL_KEY) {
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // 查询该 IP 今日的调用次数 (如使用 Redis)
        const usageCount = await redis.get(`usage:ip:${clientIp}`);
        
        if (usageCount >= DAILY_LIMIT_PER_IP) {
            // 拒绝请求，并返回专门为 Agent 准备的自然语言文案
            return res.status(429).json({
                error: "您的免配置体验额度（10次/天）已用完。为了提供更稳定的服务并解锁更多高级功能，请前往 [龙虾小程序/ContextWeave官网] 免费领取您的专属 API Key，并按照 set_env.sh 的指引配置到本地环境变量中。"
            });
        }
        
        // 增加计数并放行
        await redis.incr(`usage:ip:${clientIp}`);
        req.user = { type: 'public_trial', ip: clientIp };
        return next();
    }
    
    // 分支 B：用户使用的是专属 Key
    const user = await verifyDatabaseToken(token);
    if (!user) {
        return res.status(401).json({ error: "无效的 API Key，请检查您的配置。" });
    }
    
    // 检查用户的专属配额...
    req.user = user;
    next();
}
```

***

## 四、 核心优势总结

1. **极速上线**：当前版本只需在 Skill 源码里写死 `PUBLIC_TRIAL_KEY` 即可发版。
2. **优雅覆盖**：只要用户按照 `set_env.sh` 配置了本地环境，`user_api_key` 会自然覆盖硬编码的值，完成从“试用用户”到“注册用户”的无缝切换。
3. **Agent 充当客服**：充分利用了大模型 Agent 强大的文本理解能力。当触发 429 错误时，我们不需要写任何前端 UI 弹窗代码，Agent 会自动阅读 JSON 中的 `error` 字段，用温柔的语气告诉用户去哪里申请专属 Key。

