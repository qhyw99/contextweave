---
name: skillhub-safe-release
description: Safely validate and release SkillHub skills with staged dry-run hooks and explicit approval before Git push and publishing, including synchronized ContextWeave backend version deployment. Use for SkillHub release preparation or execution; do not use for unrelated Git pushes.
slug: skillhub-safe-release
version: 1.2.0
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

Use the bundled scripts to validate releases, wait for SkillHub approval, and deploy a synchronized backend version.

## Safety invariants

- The pre-commit hook validates only. It must never push Git commits or publish a Skill.
- ContextWeave post-commit automation is opt-in. Enable it only after the user explicitly authorizes future Skill Git pushes, SkillHub publications, and synchronized backend deployments from this repository.
- Run SkillHub `dry-run` against the staged snapshot when invoked by `pre-commit`, not against unrelated unstaged files.
- Before a real release, rerun `dry-run` and require the target Skill files to be committed.
- Never run `release --confirm push-and-publish` unless the user has explicitly approved both the Git push and SkillHub publication in the current conversation.
- Never run a manual ContextWeave coordinated release unless the user has explicitly approved the Git push, SkillHub publication, and backend deployment in the current conversation. A later post-commit run may instead rely on the repository's persistent opt-in created by `enable-auto-release`.
- Push Git first. If it fails, stop without publishing to SkillHub.
- Never deploy the backend until the exact published Skill version appears in SkillHub's public search results. A pending or rejected version must time out without deployment.
- Never print, persist in the repository, or commit an API key. Use an existing `skillhub login` session or the official credential store.

## Setup

From the target repository root, install the tracked hook:

```bash
python skills/skillhub-safe-release/scripts/skillhub_release.py install-hook
```

This sets the repository-local `core.hooksPath` and records the current Python executable for cross-platform hook execution. It does not enable post-commit release automation.

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

After the user explicitly approves the Git push, SkillHub publication, approval wait, and backend deployment, run:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py release --confirm push-publish-and-deploy
```

The wrapper runs this sequence:

1. Validate the Skill and synchronized backend version.
2. Push the Skill source branch and publish the exact version to SkillHub.
3. Poll SkillHub's public search endpoint every 30 seconds, for up to 30 minutes by default.
4. Only after the exact version is publicly visible, run the backend deployment preflight and deploy `interleaved-thinking`.

A dirty server worktree, wrong branch, failed push, failed publication, approval timeout, or failed deployment preflight stops the workflow without fallback or force operations. Rerunning `release` after the exact version is already public skips duplicate publication and resumes at the deployment gate.

## Opt-in post-commit workflow

For this ContextWeave repository only, the user can authorize future matching commits to run the same blocking workflow automatically:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py enable-auto-release
```

The tracked `post-commit` hook ignores commits that do not change `skills/interactive-architecture-diagram`. For matching commits it synchronizes and, when needed, commits only `interleaved-thinking/config.yaml`; then it pushes, publishes, waits for public approval, and deploys. The commit command remains open while approval polling runs, so failures are visible and no overlapping background release is created. The Skill version must be bumped before each published content change.

Disable the persistent opt-in with:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py disable-auto-release
```

To wait or resume manually without publishing again:

```bash
python skills/skillhub-safe-release/scripts/contextweave_release.py wait-for-approval
python skills/skillhub-safe-release/scripts/contextweave_release.py release --confirm push-publish-and-deploy
```

## Failures

Keep the first actionable validation, authentication, push, or publishing error. Do not retry a real publish automatically. A failed dry-run may be rerun after the local cause is corrected.
