# 结构化备注 v1

补充背景、限制、待确认事项使用图级备注；业务步骤、判断条件、端点和关系仍放入主图并接受原有完整性检查。不要为了缩小画布把必要内容降格为备注，也不要再为备注创建普通大容器。

## 输入

普通生成或编辑保存工作区内的绝对路径文件，并传 `--annotations_file`：

```json
{"version":1,"items":[
  {"id":"expiry_policy","text":"到期后的业务入口停用策略待确认。"},
  {"id":"worker_finish","text":"已经受理的后台任务需要明确收尾策略。"}
]}
```

id 使用稳定英文标识，重排和改文案时保持；完整正文放入 text，允许换行。每次最多 128 条，单条最多 20000 字符，总 JSON 不超过 250000 bytes。普通多视图的条目可带 view，值必须是明确、唯一的场景或层名称；省略 view 属于主图。不同图不要混用备注。首版没有备注连线、坐标和样式字段。

```bash
node scripts/generate_contextweave.cjs --input_file "<需求绝对路径>" --annotations_file "<备注绝对路径>" --output_name "license_flow" --use_default_palette
node scripts/edit_contextweave.cjs --session_id "<机器回执中的会话>" --annotations_file "<备注绝对路径>" --output_name "license_flow"
```

只有备注变动时使用第二种调用，不附加自然语言改图请求；服务复用已保存的主图几何，不调用生成模型或主图布局。省略 annotations 表示保留；显式 `[]` 或 `{"version":1,"items":[]}` 表示清空。付费版沿用当前支付入口转发同一参数，不绕过其计费流程。

结构化 JSON 在图根部放同一 annotations 对象。薄 HTML 的 main 内直接使用 `<aside id="expiry_policy">完整备注正文</aside>`；aside 不能嵌进业务容器。需要清空时使用 `<main ... data-annotations="empty">`。结构化模型首版为单图，不支持 view。备注文件和作者正文可以同时提交，但若两处均定义备注则内容必须一致。

## 展示与恢复

- HTML 右下角显示数量及两行摘要，点击展开全文，长内容在面板内滚动；切换视图同步对应备注。已绑定会话的页面可使用“编辑备注”，保存后保留缩放与主图几何。
- SVG / PNG 在主图下方追加全文备注区，扩展外部画布；主图节点和路线保持。
- 原生 PPTX / Visio 使用可编辑文本。外围空白不足时附加紧随主图的备注页，主图显示续页指引。含备注的默认 PPT 自动选择原生格式；显式导出请用 pptx-native，旧 pptx / pptx-svg 不支持可编辑备注，明确报兼容错误。页面下载同步当前视图。
- 备注保存在 CW 的版本化元数据和结构化规范模型中。导入、冷恢复和再次编辑继续保留全文及 ID。不要手改编码元数据。
- 历史普通“说明”“备注”节点仍然属于原主图。只有来源明确标注为补充备注，才人工迁移到 annotations；不能按名称自动删除。

客户端检查 `/capabilities.annotations.versions`，回执和渲染器确认 `annotations_version=1`。不兼容时报 `ANNOTATIONS_UNSUPPORTED`；几何缓存缺失的纯备注编辑报 `ANNOTATION_LAYOUT_UNAVAILABLE`，需要先明确重新导出原图建立几何记录，不能静默重排或丢弃文字。备注变化不解除原有草稿或质量状态。

脚本 JSON 继续供 Agent 解析和恢复。向用户只提供真实产物入口、交付状态和简短说明，遵循 SKILL.md 的自然语言交付规则。
