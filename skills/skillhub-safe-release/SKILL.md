---
name: skillhub-safe-release
description: Safely validate and release SkillHub skills with staged dry-run hooks and explicit approval before Git push and publishing, including synchronized ContextWeave backend version deployment. Use for SkillHub release preparation or execution; do not use for unrelated Git pushes.
slug: skillhub-safe-release
version: 1.1.0
displayName: SkillHub Safe Release
summary: Gate SkillHub releases and keep ContextWeave backend version requirements synchronized.
tags:
  - skillhub
  - release
  - git-hooks
license: MIT
homepage: https://skillhub.cn
---

# SkillHub Safe Release

Use the bundled script to keep validation automatic and remote mutations human-controlled.

## Safety invariants

- A Git hook may validate only. It must never push Git commits or publish a Skill.
- Run SkillHub `dry-run` against the staged snapshot when invoked by `pre-commit`, not against unrelated unstaged files.
- Before a real release, rerun `dry-run` and require the target Skill files to be committed.
- Never run `release --confirm push-and-publish` unless the user has explicitly approved both the Git push and SkillHub publication in the current conversation.
- Never run the ContextWeave coordinated release unless the user has explicitly approved the Git push, SkillHub publication, and backend deployment in the current conversation.
- Push Git first. If it fails, stop without publishing to SkillHub.
- Never print, persist in the repository, or commit an API key. Use an existing `skillhub login` session or the official credential store.

## Setup

From the target repository root, install the tracked hook:

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py install-hook
```

This sets the repository-local `core.hooksPath` and records the current Python executable for cross-platform hook execution.

## Dry-run

Run a non-mutating preflight for one or more Skill directories:

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py dry-run skills/my-skill
```

The command validates required front matter and calls the official CLI with:

```bash
skillhub publish <skill-path> --host https://api.skillhub.cn --dry-run --json
```

If authentication is missing, stop and ask the user to log in with the official CLI. Do not request that a token be placed in a project file.

## Human-approved release

First run `dry-run` and report the exact `slug@version` values. Ask the user whether to push the current Git branch and publish those versions.

After explicit approval, run:

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py release skills/my-skill --confirm push-and-publish
```

Without `--confirm`, the script requires a human to type the exact phrase interactively. It always repeats the dry-run before asking, rejects uncommitted target Skill changes, performs `git push`, then publishes each Skill. Return each platform URL and pending review status.

## ContextWeave coordinated release

Use the dedicated wrapper when releasing `interactive-architecture-diagram`. It reads the version from the Skill, updates the sibling `interleaved-thinking/config.yaml`, runs the proxy regression tests and SkillHub dry-run, then verifies the existing deployment workflow before any remote mutation.

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py sync-version
python skills/skillhub-safe-release/scripts/contextweave_release.py check
```

Review and commit the Skill changes in `infographic-contextweave/main` and the version change in `interleaved-thinking/v0.0.1` separately. Then run the non-mutating deployment gate:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py preflight
```

After the user explicitly approves the Git push, SkillHub publication, and backend deployment, run:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py release --confirm push-publish-and-deploy
```

The wrapper pushes and publishes the Skill first, then delegates the backend update to `ops/deploy.ps1 interleaved-thinking`. A dirty server worktree, wrong branch, failed push, failed SkillHub publication, or failed deployment preflight stops the workflow without fallback or force operations.

## Failures

Keep the first actionable validation, authentication, push, or publishing error. Do not retry a real publish automatically. A failed dry-run may be rerun after the local cause is corrected.
