# 从 cwmcp-client 迁移到独立仓库

## 新仓库定位
- 新仓库根目录即 `cw-skill`
- Skill 主体目录保持为 `contextweave-diagrams/`

## 对使用方的影响
- 脚本执行路径改为以新仓库根目录为起点
- 环境变量统一为：
  - `CONTEXTWEAVE_MCP_API_KEY`
  - `CONTEXTWEAVE_API_URL`（默认 `https://abcd.bpjwmsdb.com`）
  - `CONTEXTWEAVE_EDITOR_PROTOCOL`（可选）

## 迁移步骤
1. 克隆独立仓库并进入根目录。
2. 复制 `set_env.private.example.sh` 为 `set_env.private.sh` 并填写真实值。
3. 执行 `bash set_env.sh` 写入环境变量。
4. 按 README 中脚本命令完成生成、编辑、导入或导出。
5. 执行 `bash package_zip.sh` 生成发布包。

## 兼容建议
- 旧脚本若仍写入 `EDITOR_PROTOCOL`，请同步改为 `CONTEXTWEAVE_EDITOR_PROTOCOL`。
- 发布时仅附带 `contextweave-diagrams.zip`，不要提交 `set_env.private.sh`。
