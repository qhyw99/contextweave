# 支付宝 A2M 支付流程

仅在首次执行付费生成、支付状态不明确、履约确认失败或准备发布 Pay Skill 时读取本页。绘图内容和结构参数仍按主 `SKILL.md` 处理。

参考入口：

- SkillHub 个人 Pay Skill 指南：<https://skillhub.cn/tutorials#alipay-pay>
- 支付宝 AI 付技术接入：<https://aipay.alipay.com/open-flow/tech>

## 1. 两个价格必须一致

- **真实扣费价格**：`Payment-Needed.protocol.amount` 必须严格为 `0.05`，币种必须为 `CNY`。
- **SkillHub 展示价格**：发布表单的定价字段，目前只用于详情页展示，不参与扣费。

发布前必须确认服务注册价格、402 签名账单金额和 SkillHub 展示价格一致。运行时只以当前签名账单为准；金额有误、字段缺失、签名类型不是 `RSA2` 或账单已过期时停止支付。

## 2. 前置条件与安装边界

付费调用依赖支付宝官方 `alipay-payment-skill` 和 `alipay-bot`。缺失时只说明官方安装命令与影响：

```bash
npx -y @alipay/agent-payment@latest install
```

该命令会下载并安装支付 Skill、CLI 及其所需的本机支付组件，属于软件安装。只有用户明确同意本次安装后才能执行；不得因为用户提出绘图、同意联网或网页指南推荐安装就自动运行。

生产环境还必须满足：

- `https://pptx.chenxitech.site/a2m/run` 已实现 A2M HTTP 402 门；无有效 `Payment-Proof` 时返回 `402 + Payment-Needed`，有效凭证时才生成并返回资源。
- `Payment-Needed.protocol.resource_id` 指向与本次账单绑定、可幂等交付的 ContextWeave 资源；服务端持久化订单、金额、资源、请求摘要和履约结果。
- 服务端调用 `alipay.aipay.agent.payment.verify` 验付，并同时核对 `active=true`、本地订单号、金额、资源 ID、截止时间、订单状态和重复履约状态。
- 资源生成后调用 `alipay.aipay.agent.fulfillment.confirm`；确认失败时保存结果，允许同一付款凭证重试确认，不得重复生成或重复扣费。
- 沙箱只使用 `service_id=api_mock_service_id`；生产使用支付宝 AI 付站点注册后获得的 `API_` 开头真实 `serviceId`。私钥只在商家服务端通过环境变量或 KMS 注入。

如果 `probe` 返回 `PAYMENT_BYPASS_DETECTED`，说明未支付就取得了资源。立即停止发布；这不是客户端可以忽略的警告，必须先完成服务端 A2M 门改造。

## 3. 状态机

所有阶段必须复用 `probe` 返回的同一个 `state_dir`：

| 状态 | 含义 | 允许动作 |
|---|---|---|
| `payment_required` | 已取得并校验签名账单，尚未发起收银 | 展示商品与金额，等待明确确认；确认后执行一次 `pay` |
| `payment_pending` | 收银已发起，用户可能已付款或仍在授权 | 只运行 `complete` 查询；禁止再次 `pay` |
| `fulfillment_pending` | 已取得资源，但履约确认尚未成功 | 使用同一状态重试 `complete`；禁止重新付款或重新生成 |
| `completed` | 支付、资源交付和履约确认均完成 | 直接返回已保存结果，不再创建交易 |

状态目录默认位于当前工作区 `.cw_skill/payments/<session>`，目录和文件尽量使用 `0700/0600` 权限。不得把它提交到仓库、复制到聊天或作为用户可见附件；完成后脚本删除原始 `Payment-Needed`，只保留脱敏完成状态。

## 4. 执行流程

### 4.1 `probe`：取得账单

在已取得 ContextWeave 外发授权后执行：

```bash
node scripts/contextweave_paid.mjs probe \
  --input_file "<绝对路径>" \
  --output_name "<语义化英文名>" \
  --output_dir "docs/diagrams" \
  --diagram_style "<topology|logic|hybrid|mindmap>" \
  --morphology "<container|flow|editorial>"
```

需要主色或高亮时继续传 `--base_palette` / `--accent_targets`。`probe` 会复用原生成脚本的输入校验，保存并解码 `Payment-Needed`，但不输出原始账单、订单号或商家标识。

预期返回 `PAYMENT_CONFIRMATION_REQUIRED`，其中只包含商品名、商家名、金额、币种和有效期。使用这些字段询问：

> 本次“<商品名>”由“<商家名>”提供，支付宝签名账单金额为 ¥<金额>，有效期至 <时间>。是否确认发起本次支付？

用户只说“继续”“生成吧”但没有看到金额时，不视为确认；先展示金额再确认。

### 4.2 `pay`：拉起收银

获得明确确认后只执行一次：

```bash
node scripts/contextweave_paid.mjs pay --state_dir "<probe 返回值>" --confirmed true
```

脚本调用支付宝官方 `alipay-bot 402-buyer-pay`，并携带触发 402 的原始 URL、POST body 和必要请求头。用户通过支付宝扫码或免密授权完成付款。Agent 只编排，不代替用户确认付款，不读取或展示完整交易号、支付链接、账单或凭证。

如果命令退出异常，状态仍视为可能已创建交易。不得自动重试 `pay`，直接进入 `complete` 查询；缺少 `alipay-bot` 且明确没有发起交易时，状态才回到 `payment_required`。

### 4.3 `complete`：查询、交付与履约确认

用户完成授权后执行：

```bash
node scripts/contextweave_paid.mjs complete --state_dir "<同一 state_dir>"
```

`complete` 使用支付宝官方 `402-query-payment-status` 查询同一交易，并原样复用资源 URL、POST body 和请求头。官方 buyer-pay/query 会在取得资源后自动发送买方履约回执；只有响应包含可识别的生成资源且服务端返回有效 `Payment-Validation`，才保存 CW/SVG/HTML 并返回 `ok`。

- `PAYMENT_NOT_COMPLETED`：保留状态，稍后重复 `complete`；不要重新 `pay`。
- `FULFILLMENT_CONFIRM_FAILED`：资源已取得，使用同一状态重试 `complete`；不得重新生成或重新付款。
- `PAID_RESOURCE_MISSING`：保留状态并检查服务端输出；不得把支付成功等同于资源交付成功。
- `completed`：再次运行只返回已完成结果，不产生新交易。

## 5. 402 账单最小契约

`Payment-Needed` 必须是 Base64URL JSON，至少包含：

- `protocol`：`out_trade_no`、`amount`、`currency`、`resource_id`、`pay_before`、`seller_signature`、`seller_sign_type`、`seller_unique_id`。
- `method`：`seller_name`、`seller_id`、`seller_app_id`、`goods_name`、`seller_unique_id_key`、`service_id`。

客户端只校验结构、金额、币种、时效、签名类型与官方资源域名；真正的商家签名、支付凭证、金额和订单归属必须由商家服务端与支付宝验付接口验证。客户端校验不能替代服务端验付。

## 6. 发布前检查

- [ ] 个人开发者已在 SkillHub SkillPay 通过手机号验证码入驻。
- [ ] 支付宝开放平台已签约 AI 按量付费，AI 付站点已注册生产服务并取得真实 `serviceId`。
- [ ] 生产服务使用 HTTPS、真实 appId/公钥/私钥/支付宝公钥、正式网关和 `API_` 开头的 `serviceId`；私钥未进入仓库或 Agent 上下文。
- [ ] 沙箱已跑通 `402 → 收银 → Payment-Proof 重试 → 严格验付 → 资源交付 → 履约确认`。
- [ ] 用小金额完成一次线上真实交易验证，并在支付宝商家中心核对交易。
- [ ] SkillHub 展示价格与生产 402 账单金额一致。
- [ ] 支付取消、超时、状态不明和履约确认失败均不会自动重复扣款。
