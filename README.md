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
