# 独立视图、Layers 与 Scenarios

仅当 `SKILL.md` 中的多视图触发条件成立时读取本页。

## 1. 先判断是否真的需要拆分

通常保留单图：

- 只有一个核心问题；
- 节点和关系处于同一抽象层级；
- 弱化次要内容后，主链路仍然清楚。

通常需要拆分：

- 用户同时要求全局架构、模块内部和执行步骤；
- 多个子系统各自拥有独立边界与内部关系；
- 同一套节点上有多条链路，需要逐条聚焦；
- 单图必须混合多个抽象层级或隐藏关键关系才能装下。

不要只按节点数量机械拆分。先尝试收窄主题、弱化次要内容或提高抽象层级。

## 2. 先区分真实入口能力

| 用户真正需要的内容 | 正确机制 | 能力边界 |
|---|---|---|
| 不同模块、层级或范围，每图有自己的内容、备注、编辑和导出上下文 | `independent_views` v1 | 客户端逐个调用单图生成入口；交付独立官方交互页和统一目录 |
| 同一套完整节点与关系，只切换焦点、链路或状态 | 既有 `scenarios` / `reading_views` | 同一完整 D2 的投影，不是分别生成异构图 |
| 已有一份带 layers/scenarios 的 CW/D2，只需转换和导出 | 普通 `/convert` | 保留已有多画板转换；不证明 co_design 能联合生成多画板 |

**不要把不同内容的独立视图写成一次 co_design 请求中的 `layers`，也不要在同一张默认画布放三个根容器。** co_design 当前只接受单画板；`reading_views` 也不是三个独立图源的生成编排。

脚本会先查询 `/capabilities`。只有后端声明以下能力时才执行：

```json
{
  "independent_views": {
    "versions": [1],
    "execution": "client_orchestrated_single_diagrams",
    "manifest_version": 1,
    "native_layers": false
  }
}
```

旧后端未声明该能力时，脚本在生成前返回 `INDEPENDENT_VIEWS_UNSUPPORTED`。不得自动改成单图合并请求。

## 3. 整理并确认独立视图计划

在创建计划文件和调用脚本前，给出：

- 每个视图稳定的 `view_id`、名称、焦点和抽象层级；
- 每图负责的事实及跨图接口两端；
- 每图自己的备注，不能把全部备注迁往默认图；
- 拆分理由。

用户原请求已经明确指定视图和内容时，不重复征求拆分同意。用户修改方案时更新计划并重新计算计划摘要。

计划使用版本化 JSON。每个视图必须且只能提供 `request`、`authoring`、`outline` 之一；`request` 是该图的完整独立材料，不得只写“参考其他视图”。下面是合成结构示例：

```json
{
  "version": 1,
  "source": "合成系统包含网关、订单和库存。",
  "views": [
    {
      "view_id": "architecture",
      "name": "系统架构",
      "focus": "网关到订单的依赖",
      "abstraction": "macro",
      "request": "单独生成系统架构图，只表达网关、订单和库存的依赖关系。",
      "annotations": {
        "version": 1,
        "items": [{"id": "architecture-note-1", "text": "架构图自己的备注"}]
      }
    },
    {
      "view_id": "process",
      "name": "下单流程",
      "focus": "下单到库存锁定",
      "abstraction": "meso",
      "request": "单独生成下单流程图，只表达提交订单、校验和锁定库存的步骤。",
      "annotations": {"version": 1, "items": []}
    }
  ],
  "facts": [
    {"fact_id": "fact-architecture", "view_id": "architecture", "text": "网关调用订单", "evidence": {"kind": "node", "id": "gateway", "label": "网关调用订单"}},
    {"fact_id": "fact-process", "view_id": "process", "text": "订单锁定库存", "evidence": {"kind": "node", "id": "inventory", "label": "订单锁定库存"}}
  ],
  "interfaces": [
    {
      "name": "订单调用接口",
      "endpoints": [
        {"view_id": "architecture", "fact_id": "fact-architecture", "evidence": {"kind": "edge", "from": "gateway", "to": "orders", "label": "订单调用接口"}},
        {"view_id": "process", "fact_id": "fact-process", "evidence": {"kind": "edge", "from": "submit", "to": "route", "label": "订单调用接口"}}
      ]
    }
  ]
}
```

每条必需事实必须恰好有一个负责视图。跨图接口至少有两个端点，端点必须引用已登记事实，且所属视图一致；缺失、重复或冲突时返回 `VIEW_COVERAGE_INVALID`，不能标整组已验收。

每条事实都要在当前产物中找到证据：用 `node {id,label}`、`edge {from,to,label}` 或 `annotation {id}` 指定本图对象。有向边须核对起点、终点、方向和名称；短标签用 `full_text_annotation_id` 指向该视图精确 CW 中含完整 `fact.text` 的备注。缺省的 `directed_interface` 需要各端的边证据；主图与详情引用同一实体时用 `kind:"entity_reference"`、稳定的 `entity_id` 和 `name`，各端提供本图的节点证据及负责的 `fact_id`，不虚构有向业务边。

`authoring` 可为原始 JSON 模型，或 `{"version":1,"format":"json","source":{...}}`、`{"version":1,"format":"html","source":"..."}`。核对后端实际返回的规范模型、正式页面绑定的精确 CW、对象和备注。普通 co_design 还须提供针对本图完整输入和最终图源的完整 JEV 审阅记录。单图 accepted 不等于组已验收：证据缺失记为 `unverified`，内容或身份冲突记为 `rejected`，组保持 `incomplete`。

普通 `request` 子请求会实际携带共享 source、当前任务和焦点、本图负责 facts、相关 interfaces 以及 `hard_constraints`，不是只发送一句绘图建议。其他视图的自然语言生成任务不会混入本图。

### 3.1 尚未锁定图型时的前置呈现规划

代码／模块职责与复用地图可提交完整原文、阅读问题、稳定事实 ID 和来源引句。将原文明确的箭头作为 `relation` 事实保留两端、方向与标签；从只剩单元格的派生表中可能无法恢复这些信息。把用户硬约束与 Agent 的呈现建议分别记录。用户交来编译的规范模型直接走 authoring。从原文选用矩阵时按[场景表](authoring.md#自然语言新建时的模板选型)核对业务归属。

```bash
node scripts/generate_presentation_plan.cjs --input_file "<绝对路径>/presentation-input.json" --output_dir "<工作区内绝对输出目录>"
```

一次 JEV 选型在当前授权和预算内时，可在同一命令加 `--execute_jev`。只有已确定具体候选时才传 `--choose <候选 ID>`。根据返回的选择来源、候选事实映射与覆盖结果执行。唯一可行的候选可直接选定。 查看实际候选名。代码地图 v3 的 `single_cards` 和 `main_detail` 比较的是一页卡片与主图加详情两种安排。如果读者要沿迁移链逐条追踪多个来源，普通单图可直接承载这些关系。生成后的 JEV 边与覆盖审阅发生在成图阶段。

客户端先核对 `presentation_planning.decision_stage=before_authoring_model_materialization` 和上述 `independent_views` 能力。后端先构造少量可执行语义候选及完整事实映射，选定后才规范化并编译所选 authoring；`stage-events.json` 必须证明该顺序。候选不是三份预先固化的规范模型，也不是 `reading_views` 的后置投影。

主图／详情候选输出本页同一 `view-plan.json`，下一步仍使用 `generate_view_group.cjs`。单图候选输出 `authoring.json`，交给既有结构化入口。逐项比较返回 `not_applicable` 和 `next_route: general`。从 `presentation_input_file` 取原文、阅读问题和展示要求，继续普通生成。即使指定了旧候选名也适用此规则。

非法 ID、低置信、预算不足、超时或无有效选择时只保存 `selection_required` 与诊断，不输出可执行计划、不隐式采用第一个候选。已收到负向答案也按实际 usage 结算，unknown 保守占满预留；只有未发起的预算拒绝或调用前超时释放。未支持的硬约束在选型前明确拒绝。冻结记录的 source、事实、约束或候选版本变化后必须重新规划；冻结重放不新增选择调用。

## 4. 执行独立单图编排

```bash
node scripts/generate_view_group.cjs --plan_file "<绝对路径>/view-group.json" --output_dir "<工作区内绝对输出目录>" --group_token_limit 12000 --attempt_token_limit 4000
```

编排器默认有界顺序执行，不通过并发子会话绕过同一任务预算。每个视图独立调用已有单图入口，获得自己的：

- `session_id`、修订号和精确 CW 源 SHA-256；
- `quality`、成功／草稿／失败／待重试状态；
- 官方 HTML、SVG 和本地文件清单；
- 备注、实际模型调用与 token 用量、脱敏回执。

组上限由 `--group_token_limit` 指定，每次调用前按 `--attempt_token_limit` 向服务端账本预留，实际子请求携带同一上限。恢复沿用原账本。完整回执按增量结算，未知消费保留已知小计并占用预留，确定未提交时释放额度。逐图计费以各自回执为准。

用量区分普通增量、co_design 工作流累计、authoring 已证实零模型、not_called 零实际用量和 unknown。续跑同一工作流时只累计新增部分；任何未知都会令组 totals 为 null，同时保留 known subtotal，绝不把 unknown 当零。

最小交付是 `index.html` 中多个有名称的独立官方交互页链接及本地副本。目录不是单页 Tab，也不声称原生 layers 已支持；每图编辑、导出和备注继续使用自己的会话与源摘要。只有 PPTX/SVG 而没有独立 HTML 的响应返回 `VIEW_INTERACTIVE_DELIVERY_MISSING`，整组不得标为 accepted；PPTX-only 变体需要额外交互页交付集成，不能用 Office 文件替代。

pay 变体还必须复用既有 A2M 状态机逐个子请求展示真实金额、取得确认并履约；通用编排脚本不会自动付款或把一次确认扩大到整组。未完成该集成时保留 `PAYMENT_REQUIRED` 和 manifest，不跳过支付门。

## 5. 部分失败与恢复

输出目录中的 `view-group-manifest.json` 原子保存版本、计划摘要、事实归属、跨图接口、逐图状态、每次尝试用量和回执。第二图失败不会删除第一、第三图结果；只要任一图未接受，整组就是 `incomplete`。

使用同一计划和输出目录恢复：

```bash
node scripts/generate_view_group.cjs --plan_file "<绝对路径>/view-group.json" --output_dir "<原输出目录>" --resume
```

- 已接受视图先核对本地 CW 与保存的 SHA-256，随后跳过，不重复生成或覆盖。
- 已有工作流通过 `continuation_session_id` 和保存的 revision 续改；展示页及源码导出使用该图的 `session_id`。恢复发送精确当前 CW，并核对服务端剩余额度。
- 原请求结果未知时先按保存的 request ID／回执凭证查询；查询不到就保持 `VIEW_RECEIPT_UNCONFIRMED`，不能自动再发收费请求。
- 计划摘要变化时拒绝覆盖旧组；已接受源缺失或摘要不匹配时明确失败，不把另一图的源或会话拿来顶替。
- 恢复保留历史尝试，累计子请求、模型调用、token 和回执数量，不重复计算被跳过的已接受图。

## 6. Scenarios 的既有规则

只有“同一套完整节点与关系，只改变聚焦路径或状态”时才使用 scenarios：

1. **单一数据源**：先维护一份包含全部共用节点和关系的基础图。
2. **增量覆盖**：每个 scenario 只描述相对基础图变化的聚焦效果或状态。
3. **禁止复制整图**：不得为每条链路复制、拼接一份完整架构。
4. **优先弱化而非删除**：淡化无关组件并高亮目标关系，以保留整体上下文。
5. **使用业务化命名**：采用 `CreateOrder`、`Callback` 等名称，避免 `Scenario1`。

不同模块、层级或范围的独立内容不要误用 scenarios。只强调主图一条链路时，也不必额外创建 scenario。

## 7. 执行前检查

- [ ] 已说明为什么单图不够。
- [ ] 已按“独立内容 / 同图不同焦点 / 已有多画板转换”选择真实入口。
- [ ] 每个视图的 ID、名称、焦点、抽象层级、输入和事实归属明确。
- [ ] 已取得用户确认，或原请求已明确指定拆分方案。
- [ ] 每图备注留在本图，跨图接口两端完整且名称一致。
- [ ] 已查询能力；没有把 layers 自然语言直接交给单画板 co_design。
- [ ] 交付使用独立页面目录，没有用三个根容器或只切 SVG 的假 Tab 替代。
- [ ] 部分失败保留结果，恢复只处理未完成项，整组状态没有被提前标为 accepted。
