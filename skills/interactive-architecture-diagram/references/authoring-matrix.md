# 共享轨道矩阵

用于不同区域按同一组行对齐、某列合并多行的图，例如组织职责矩阵和中车流程矩阵。所有列共享行边界，后端按所有列的内容共同计算行高。

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
