# cw-skill

ContextWeave 绘图 Skill 的独立仓库目录，提供请求编排脚本、会话导入导出脚本与 zip 打包能力。

## 目录结构
- `contextweave-diagrams/`：Skill 主体（`SKILL.md`、`_meta.json`、`scripts/`）
- `set_env.sh`：环境变量写入脚本（Bash/Zsh/Fish/PowerShell）
- `set_env.private.example.sh`：私有配置模板
- `package_zip.sh`：发布压缩包生成脚本

## 前置要求
- Node.js（用于运行 `contextweave-diagrams/scripts/*.cjs`）
- zip 命令（用于打包发布）
- 可用环境变量：
  - `CONTEXTWEAVE_MCP_API_KEY`
  - `CONTEXTWEAVE_API_URL`
  - `CONTEXTWEAVE_EDITOR_PROTOCOL`（可选，默认 `trae`）

## 快速开始
1. 复制私有配置模板：
   - `cp set_env.private.example.sh set_env.private.sh`
2. 编辑 `set_env.private.sh`，填入：
   - `CONTEXTWEAVE_MCP_API_KEY_VALUE`
   - `CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE`
3. 执行环境注入：
   - `bash set_env.sh`
4. 在仓库根目录执行脚本：
   - `node contextweave-diagrams/scripts/generate_contextweave.cjs --input_file "/绝对路径/request_xxx.md"`

## 常用脚本
- 生成图：`node contextweave-diagrams/scripts/generate_contextweave.cjs --input_file "/abs/path/request.md"`
- 基于 session 编辑：`node contextweave-diagrams/scripts/edit_contextweave.cjs --session_id "<sid>" --user_request "xxx"`
- 导入 cw 代码：`node contextweave-diagrams/scripts/import_contextweave_code.cjs --path "/abs/path/ContextWeave"`
- 导出 cw 代码：`node contextweave-diagrams/scripts/export_contextweave_code.cjs --session_id "<sid>" --path "/abs/path/ContextWeave"`
- 导出会话资产：`node contextweave-diagrams/scripts/export_session_asset.cjs --session_id "<sid>" --format svg`

## 打包发布
在仓库根目录执行：

```bash
bash package_zip.sh
```

默认生成 `contextweave-diagrams.zip`，可传参自定义名称：

```bash
bash package_zip.sh contextweave-diagrams-v0.1.0.zip
```

## 发布建议
- 使用语义化版本 tag（如 `v0.1.0`）
- 将 zip 产物作为 release 附件
- 发布说明包含环境变量、最小使用示例与迁移说明

## 迁移说明
- 仓库边界定义见 `REPO_SCOPE.md`
- 独立仓库准备计划见 `PLAN.md`
- 使用方迁移步骤见 `MIGRATION.md`
