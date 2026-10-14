# 结果恢复

## 已生成内容但未通过验收

`status=error` 或退出码 1 不代表没有生成内容。检查 `saved_artifacts`、`saved_svg_file` 和 `saved_pptx_file`，交付已保存文件链接，并说明质量问题与 `receipt.quota.status`。PPTX 导出失败时仍交付实际已有的 SVG 或生成源。`editable=false` 的只读候选不能自动导入正式会话或称为正式成品。

权威终态回执不自动重新生成，5xx 也遵循这一例外。下载失败须说明尚未本地保存，保留回执并通过 `query_request.cjs` 找回；查询不扣次。分片未完整合并时说明缺失。不要把 Key/token 放进链接或聊天。同号只回放；继续生成使用新请求，只有恢复动作允许且预算有效时才携带返回 session 和 `--co_design_revision`。取消后只交付已有材料，无生成内容时不把输入当输出。

## 请求记录与结果找回

生成请求发送前保存 `.cw_skill/requests/<请求号>.receipt.json`；成功、草稿和失败都会写回原响应。网络异常时状态为未确认，不能推断已失败或未扣次。先查询原请求，不要直接再次生成：

```bash
node scripts/query_request.cjs --record "/绝对路径/请求号.receipt.json" --output_dir "/绝对路径/输出目录"
node scripts/query_request.cjs --list
node scripts/query_request.cjs --request_id "原请求号" --output_dir "/绝对路径/输出目录"
```

查询使用现有环境变量里的额度 Key；公共体验必须保留原回执文件中的随机查询凭证。不要将 Key 写入命令、回执或反馈。查询本身不扣次，有结果时恢复 CW 和文件；运行中继续等待，无可用结果且已返还后才可发起新的请求。有图但未通过完整校验时交付草稿并说明 warnings。面向用户应给出文件（若有）、本次次数处理及记录位置，不能只转述错误码。

用户也可以打开 https://pptx.chenxitech.site/requests/view ，输入邮件额度 Key 查看上线后的记录。会话状态仍由后端托管，本地文件仅保存请求回执。旧请求没有完整回执，不声称已经自动补录。
