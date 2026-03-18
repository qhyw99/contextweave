# cw-skill 独立 GitHub 仓库实施计划

## 目标

* 将 `cw-skill` 从当前 `cwmcp-client` 仓库中独立为可单独维护、发布、使用的 GitHub 项目。

* 保持现有 skill 能力不变，降低迁移对现有使用方的影响。

## 范围与原则

* 本次迁移对象：`/data/appdata/cwmcp-client/cw-skill` 目录及其运行/打包所需文件。

* 不改动业务能力语义，仅做仓库边界、工程化与发布流程整理。

* 迁移后仓库应可独立完成：配置、运行、打包、发布说明。

## 关键现状

* 主要内容位于 `contextweave-diagrams/`，包含 `SKILL.md`、`_meta.json` 与脚本入口。

* 发布入口是 `package_zip.sh`，产出 `contextweave-diagrams.zip`。

* 依赖以 Node 内置模块为主，未发现独立 `package.json`。

* 存在配置命名不一致：`set_env.sh` 中 `EDITOR_PROTOCOL` 与脚本读取的 `CONTEXTWEAVE_EDITOR_PROTOCOL`。

## 实施步骤

1. 规划新仓库结构与迁移清单

   * 以 [infographic-contextweave](https://skills.sh/tuziapi/tuzi-skills/tuzi-infographic)作为新仓库根目录，保留 `contextweave-diagrams/` 与现有脚本。

   * 明确必须迁移文件、可选文件、历史产物文件（zip）处理策略。

2. 建立独立仓库基础工程化文件

   * 新增仓库级 `README.md`，覆盖安装前置、环境变量、运行示例、打包发布。

   * 补齐 `.gitignore`，排除私有配置与打包产物。

   * 视需要补充 License、版本说明与变更记录模板。

3. 统一配置与入口约定

   * 统一 `EDITOR_PROTOCOL` 与 `CONTEXTWEAVE_EDITOR_PROTOCOL` 命名策略，统一使用`CONTEXTWEAVE_EDITOR_PROTOCOL`。

   * 明确 `CONTEXTWEAVE_MCP_API_KEY`、`CONTEXTWEAVE_API_URL` 的必填/默认行为。

   * 保证脚本在新仓库相对路径下可直接运行。

4. 打包与发布流程独立化

   * 校准 `package_zip.sh` 以适配新仓库根目录执行。

   * 明确版本发布流程（tag 规范、release 附件为 zip 包）。

   * 补充最小 CI（可选）用于打包验证与发布自动化。

5. 兼容迁移与回退策略

   * 在原仓库保留过渡说明，指向新仓库地址。

   * 为旧使用方式提供短期兼容文档或映射说明。

   * 定义回退方案：若独立仓库发布异常，如何临时回切旧路径。

## 验收标准

* 新仓库从零克隆后，可按文档完成环境配置并运行核心脚本。

* 可在新仓库成功生成 `contextweave-diagrams.zip`。

* 环境变量命名与文档一致，无冲突项。

* 对外说明完整：快速开始、发布步骤、迁移指引可直接执行。

## 风险与缓解

* 风险：迁移后路径变化导致脚本失败。\
  缓解：逐项验证脚本入口，增加路径自检与错误提示。

* 风险：用户沿用旧环境变量命名导致不可用。\
  缓解：统一命名并在文档与报错中给出明确迁移提示。

* 风险：私有配置被误提交。\
  缓解：完善 `.gitignore` 与示例配置文件，移除私有文件默认纳入。

## 执行顺序建议

* 先完成仓库结构与文档，再处理配置统一，最后做打包发布与迁移公告。

