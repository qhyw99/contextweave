# 共享轨道矩阵

用于不同区域按同一组行对齐、某列合并多行的图，例如组织职责矩阵和中车流程矩阵。所有列共享行边界，后端按所有列的内容共同计算行高。

新建矩阵优先使用规范 JSON，减少 HTML 嵌套与角色语法错误。只有 `section/group/entity/layout` 四种节点角色；横带是 `role:"group"`，不是 `band`。没有参考方案的普通矩阵仍可省略模板。

## 对齐中央分区案例的视觉方案

当用户要求参考中车式中央业务区、红色侧栏、粉色基础/规划区、金色业务横带和底部通栏保障，并且内容适合这七列时，选 `enterprise-central-v1`。它绑定已有 `crrc-central-v1` 编译模板；不用模型逐格配色或设尺寸。若内容不适合七列，保留真实结构，使用通用矩阵或联合生成，不强塞此方案。

调用时把选择保留在正文之外：`--base_palette '{"style_preset":"enterprise-central-v1"}'`，同时规范 JSON 保存 `presentation_preset:"enterprise-central-v1"`。会话编辑可省略命令参数，程序继承已有方案；不能把选定方案降级成普通默认模板。客户端先核对后端声明的方案能力。

以下仅为三轨道协议骨架，内容、行数与跨度应按原文扩展。七列 ID 及顺序固定；`core` 的前两格 ID 是 `foundation`、`planning`，后续业务格 ID 自定。每个 core 分区用 `role:"group"`、`columns`、`items` 表达横向子项。每列 start/span 必须覆盖全部公共轨道。保障内容放在顶层 `footer`，不能变成第八列。模板不会猜测并挪动业务内容。

```json
{
  "kind":"matrix", "template":"crrc-central-v1", "presentation_preset":"enterprise-central-v1",
  "title":"协同架构", "rows":3,
  "columns":[
    {"id":"benefits","cells":[{"title":"业务目标","start":1,"span":3}]},
    {"id":"categories","cells":[{"title":"业务分类","start":1,"span":3}]},
    {"id":"core","cells":[
      {"id":"foundation","title":"基础能力","role":"group","start":1,"span":1,"columns":2,"items":[{"title":"制度"},{"title":"标准"}]},
      {"id":"planning","title":"统筹规划","role":"group","start":2,"span":1,"columns":2,"items":[{"title":"需求"},{"title":"计划"}]},
      {"id":"execution","title":"执行","role":"group","start":3,"span":1,"columns":2,"items":[{"title":"实施"},{"title":"验收"}]}
    ]},
    {"id":"purchasing_modes","cells":[{"title":"组织方式","start":1,"span":3}]},
    {"id":"departments","cells":[{"title":"职责部门","start":1,"span":3}]},
    {"id":"management_levels","cells":[{"title":"管理层级","start":1,"span":3}]},
    {"id":"legal_levels","cells":[{"title":"法人层级","start":1,"span":3}]}
  ],
  "footer":"贯穿各区域的审计与监督保障"
}
```

## 普通矩阵的等价语法

```html
<main data-kind="matrix" data-title="组织职责" data-rows="3">
  <section id="department" data-title="部门">
    <p id="headquarters" data-start="1" data-span="2">总部</p>
    <p id="branch" data-start="3">分部</p>
  </section>
  <section id="stage" data-title="阶段">
    <p id="planning">规划</p>
    <p id="execution">执行</p>
    <p id="review">复核</p>
  </section>
</main>
```

等价 JSON（实际调用只选一种）：

```json
{"kind":"matrix","title":"组织职责","rows":3,"columns":[{"id":"department","title":"部门","cells":[{"id":"headquarters","title":"总部","start":1,"span":2},{"id":"branch","title":"分部","start":3}]},{"id":"stage","title":"阶段","cells":[{"id":"planning","title":"规划"},{"id":"execution","title":"执行"},{"id":"review","title":"复核"}]}]}
```

- `rows` 创建时可用正整数；规范模型返回如 `[{"id":"row_1"},{"id":"row_2"}]` 的行列表，编辑时保留这些 ID。追加一行可在列表末尾加入 `{}`，同时给每列增加单元格或延长末格的 `span`，让所有列覆盖新增行。
- `start` 从 1 起算，省略时接在上一格之后；`span` 默认 1。HTML 对应 `data-start`、`data-span`。
- 每列必须完整覆盖所有行，不允许空洞、重叠或越界；空内容也要显式表达一个有意义的格子，不能默默错开行。
- 格子可使用嵌套 `section` / JSON `items` 表达内部卡片，嵌套布局遵循 [卡片协议](authoring-cards.md)。
- 行数、列数和跨度可变。不要写每行高度、每列宽度、定位坐标或 CSS。
- 任意二维拼块、跨列重叠和完整 CSS Grid 不属于该结构；此类要求走 general。
