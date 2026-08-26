# contextweave

单仓多 Skill 仓库，使用 `skills/<skill-folder>/SKILL.md` 组织技能。

## 当前技能

- `skills/interactive-infographic/SKILL.md`
- `skills/interactive-architecture-diagram/SKILL.md`

## 目录结构

```text
contextweave/
└── skills/
    ├── interactive-infographic/
    │   └── SKILL.md
    └── interactive-architecture-diagram/
        └── SKILL.md
```

## 使用方式

Skill 名以各自 `SKILL.md` 中 `name` 字段为准，对应安装示例：

```bash
npx skills add qhyw99/contextweave@interactive-infographic -g -y
npx skills add qhyw99/contextweave@interactive-architecture-diagram -g -y
```

## 约定

- `@` 后的值对应 `skills/` 下子目录中的 Skill 名
- 新增 Skill 时保持 `skills/<skill-name>/SKILL.md` 结构
- 仓库可承载多个技能，按场景独立演进

## SkillHub 安全发布

仓库内置 `skillhub-safe-release`，将发布拆成自动预检和人工确认两个阶段。

首次启用提交 Hook：

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py install-hook
```

启用后，每次提交若包含 `skills/<name>/` 下的暂存变更，`pre-commit` 会针对暂存区快照执行 SkillHub `dry-run`。Hook 不会执行 `git push` 或正式发布。

手动预检和正式发布：

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py dry-run skills/interactive-architecture-diagram
python skills/skillhub-safe-release/scripts/skillhub_release.py release skills/interactive-architecture-diagram
```

`release` 会再次预检并要求人工确认；确认后先执行 `git push`，push 成功后才会正式发布到 SkillHub。
