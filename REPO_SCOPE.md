# cw-skill 独立仓库边界

## 纳入新仓库
- `contextweave-diagrams/` 全量内容
- `package_zip.sh`
- `set_env.sh`
- `set_env.private.example.sh`
- `README.md`
- `PLAN.md`
- `REPO_SCOPE.md`
- `.gitignore`

## 不纳入版本控制
- `set_env.private.sh`
- `contextweave-diagrams.zip`

## 迁移后目录基线
- 根目录脚本用于环境配置与发布打包
- `contextweave-diagrams/` 作为 Skill 主目录
- 所有对外说明统一以仓库根目录 `README.md` 为入口
