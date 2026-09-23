# 异常恢复

仅在脚本返回等待、支付状态不明、错误，或用户需要提交反馈时读取本页。

## 1. 按错误类型处理

| 错误或状态 | 处理方式 |
|---|---|
| `INVALID_REQUEST_LENGTH` | 把请求调整到允许长度后重试 |
| `MISSING_SESSION_ID` | 校验返回并立即重试当前请求 |
| `SESSION_INVALID_OR_EXPIRED` | 重建会话，再回放当前意图 |
| `AUTH_ERROR` | 付费入口配置异常；检查 A2M 服务状态，不要向用户索要 API Key 或改走免费入口 |
| `API_ERROR` | 脚本已自动进行 3 次指数退避；仍失败时检查网络或服务状态 |
| `WAITING_FOR_EXPERT_PROCESSING` | 告知用户仍在处理，并主动轮询结果 |
| `A2M_PAYMENT_REQUIRED` | 正常付费门；按 [支付宝 A2M 支付流程](payment-flow.md) 展示账单并等待明确确认 |
| `PAYMENT_STATUS_UNCERTAIN` / `PAYMENT_NOT_COMPLETED` | 查询同一支付会话；禁止再次运行 `pay` |
| `FULFILLMENT_CONFIRM_FAILED` | 使用同一 `state_dir` 重试 `complete`；禁止重新付款 |
| `A2M_PROTOCOL_ERROR` | 402 响应缺少合法 `Payment-Needed`；停止付款并检查服务端 A2M 配置 |
| `A2M_RATE_LIMITED` | 付费入口暂时限流；保持原请求 ID，稍后重试同一请求，不得自动重新付款 |

本地预检错误：未落盘或未执行使用 `EXECUTION_NOT_PERFORMED`；文件不存在使用 `INPUT_FILE_NOT_FOUND`；路径不是绝对路径使用 `INPUT_FILE_NOT_ABSOLUTE`。

## 2. 等待专家处理

后端返回 `WAITING_FOR_EXPERT_PROCESSING` 或耗时过长时：

1. 简短告知用户：“图表较复杂，后端正在深度生成，请稍候。”
2. 当前任务已经获得联网授权时，直接主动调用：

   ```bash
   node scripts/recompile_contextweave.cjs --session_id "<session_id>"
   ```

3. 脚本内置轮询与退避；不要让用户手动触发下一步。

## 3. 彻底失败与反馈

重试和轮询后仍失败时，说明当前原因，并询问用户是否愿意提交反馈及留下联系邮箱。若当前任务授权未覆盖反馈内容，简要说明会发送 `session_id`、反馈和失败分析并确认一次；用户同意提交反馈后不再另行确认邮箱字段。

获得本次明确授权后调用：

```bash
node scripts/submit_feedback.cjs --session_id "<session_id>" --user_complaint "用户邮箱：<邮箱>，问题描述：<反馈>" --agent_analysis "<失败分析>"
```

只提交解决问题所需的信息，不发送无关源码、密钥、个人信息或完整目录结构。
