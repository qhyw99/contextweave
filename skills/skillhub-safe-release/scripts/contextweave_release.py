#!/usr/bin/env python3
"""Coordinate ContextWeave SkillHub publication with the backend version gate."""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence

from skillhub_release import (
    CONFIRMATION as SKILLHUB_CONFIRMATION,
    ReleaseError,
    find_repo_root,
    resolve_skill,
)


SOURCE_BRANCH = "main"
SOURCE_SKILL = Path("skills/interactive-architecture-diagram")
DOWNSTREAM_REPO_NAME = "interleaved-thinking"
DOWNSTREAM_BRANCH = "v0.0.1"
DOWNSTREAM_CONFIG = Path("config.yaml")
DEPLOY_CONFIRMATION = "push-publish-and-deploy"
VERSION_LINE_RE = re.compile(
    r"^(?P<prefix>\s*required_skill_version:\s*)"
    r"(?P<quote>['\"]?)(?P<version>[^'\"\s#]+)(?P=quote)"
    r"(?P<suffix>\s*(?:#.*)?)$",
    re.MULTILINE,
)


def configure_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def run(command: Sequence[str], *, cwd: Path) -> None:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    output = (result.stdout or "").rstrip()
    if output:
        print(output)
    if result.returncode != 0:
        rendered = subprocess.list2cmdline(list(command))
        raise ReleaseError(f"Command failed: {rendered}")


def git_output(repo: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise ReleaseError(result.stdout.strip() or f"git {' '.join(arguments)} failed")
    return result.stdout.strip()


def resolve_downstream_repo(source_repo: Path, raw_path: str | None) -> Path:
    path = Path(raw_path).resolve() if raw_path else source_repo.parent / DOWNSTREAM_REPO_NAME
    if not (path / ".git").exists():
        raise ReleaseError(f"Downstream Git repository was not found: {path}")
    return path.resolve()


def resolve_deploy_script(source_repo: Path, raw_path: str | None) -> Path:
    path = Path(raw_path).resolve() if raw_path else source_repo.parent / "ops" / "deploy.ps1"
    if not path.is_file():
        raise ReleaseError(f"Deployment script was not found: {path}")
    return path


def require_branch(repo: Path, expected: str) -> None:
    actual = git_output(repo, "branch", "--show-current")
    if actual != expected:
        raise ReleaseError(f"Expected branch {expected!r} in {repo}, found {actual!r}")


def read_config_text(config_file: Path) -> str:
    try:
        with config_file.open("r", encoding="utf-8", newline="") as handle:
            return handle.read()
    except OSError as exc:
        raise ReleaseError(f"Cannot read {config_file}: {exc}") from exc


def required_skill_version(config_file: Path) -> str:
    matches = list(VERSION_LINE_RE.finditer(read_config_text(config_file)))
    if len(matches) != 1:
        raise ReleaseError(
            f"Expected exactly one required_skill_version entry in {config_file}, found {len(matches)}"
        )
    return matches[0].group("version")


def write_required_skill_version(config_file: Path, version: str) -> bool:
    content = read_config_text(config_file)
    matches = list(VERSION_LINE_RE.finditer(content))
    if len(matches) != 1:
        raise ReleaseError(
            f"Expected exactly one required_skill_version entry in {config_file}, found {len(matches)}"
        )
    match = matches[0]
    replacement = f'{match.group("prefix")}"{version}"{match.group("suffix")}'
    updated = content[: match.start()] + replacement + content[match.end() :]
    if updated == content:
        return False
    try:
        with config_file.open("w", encoding="utf-8", newline="") as handle:
            handle.write(updated)
    except OSError as exc:
        raise ReleaseError(f"Cannot update {config_file}: {exc}") from exc
    return True


def ensure_path_clean(repo: Path, relative_path: Path) -> None:
    status = git_output(
        repo,
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        relative_path.as_posix(),
    )
    if status:
        raise ReleaseError(f"Commit {relative_path} in {repo} before release:\n{status}")


def powershell_executable() -> str:
    executable = shutil.which("pwsh") or shutil.which("powershell")
    if not executable:
        raise ReleaseError("PowerShell was not found; cannot run ops/deploy.ps1")
    return executable


def context(source_repo: Path, downstream_path: str | None) -> tuple[Path, Path, str]:
    downstream_repo = resolve_downstream_repo(source_repo, downstream_path)
    require_branch(source_repo, SOURCE_BRANCH)
    require_branch(downstream_repo, DOWNSTREAM_BRANCH)
    skill = resolve_skill(source_repo, SOURCE_SKILL)
    return downstream_repo, downstream_repo / DOWNSTREAM_CONFIG, skill.version


def sync_version(source_repo: Path, downstream_path: str | None) -> None:
    downstream_repo, config_file, skill_version = context(source_repo, downstream_path)
    changed = write_required_skill_version(config_file, skill_version)
    action = "updated" if changed else "already synchronized"
    print(f"[contextweave] {action}: {config_file} -> {skill_version}")


def run_checks(source_repo: Path, downstream_path: str | None) -> None:
    downstream_repo, config_file, skill_version = context(source_repo, downstream_path)
    configured_version = required_skill_version(config_file)
    if configured_version != skill_version:
        raise ReleaseError(
            f"Version mismatch: Skill is {skill_version}, {config_file} requires {configured_version}. "
            "Run sync-version first."
        )

    commands = [
        ["node", "--check", str(SOURCE_SKILL / "scripts" / "cw_client.cjs")],
        ["node", "tests/cw_client_proxy_test.js"],
        ["node", "tests/export_session_asset_formats_test.js"],
        ["node", "tests/normalize_asset_result_test.js"],
        [
            sys.executable,
            str(Path(__file__).with_name("skillhub_release.py")),
            "dry-run",
            str(SOURCE_SKILL),
        ],
    ]
    for command in commands:
        run(command, cwd=source_repo)
    print(
        "[contextweave] checks passed: "
        f"contextweave-interactive-architecture@{skill_version}, "
        f"{downstream_repo.name}/{DOWNSTREAM_CONFIG}"
    )


def deploy_preflight(source_repo: Path, downstream_path: str | None, deploy_path: str | None) -> None:
    downstream_repo, config_file, _ = context(source_repo, downstream_path)
    ensure_path_clean(source_repo, SOURCE_SKILL)
    ensure_path_clean(downstream_repo, DOWNSTREAM_CONFIG)
    run_checks(source_repo, downstream_path)
    deploy_script = resolve_deploy_script(source_repo, deploy_path)
    run(
        [
            powershell_executable(),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(deploy_script),
            DOWNSTREAM_REPO_NAME,
            "-CheckOnly",
        ],
        cwd=source_repo.parent,
    )
    print("[contextweave] downstream deployment preflight passed")


def release(
    source_repo: Path,
    downstream_path: str | None,
    deploy_path: str | None,
    confirmation: str | None,
) -> None:
    if confirmation != DEPLOY_CONFIRMATION:
        raise ReleaseError(
            "Explicit approval is required for Git push, SkillHub publication, and backend deployment. "
            f"After approval, rerun with --confirm {DEPLOY_CONFIRMATION}."
        )

    deploy_preflight(source_repo, downstream_path, deploy_path)
    release_script = Path(__file__).with_name("skillhub_release.py")
    run(
        [
            sys.executable,
            str(release_script),
            "release",
            str(SOURCE_SKILL),
            "--confirm",
            SKILLHUB_CONFIRMATION,
        ],
        cwd=source_repo,
    )

    deploy_script = resolve_deploy_script(source_repo, deploy_path)
    run(
        [
            powershell_executable(),
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(deploy_script),
            DOWNSTREAM_REPO_NAME,
        ],
        cwd=source_repo.parent,
    )
    print("[contextweave] SkillHub publication and backend version deployment completed")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Keep the ContextWeave SkillHub version and backend version gate synchronized."
    )
    parser.add_argument(
        "--downstream-repo",
        help="Path to interleaved-thinking; defaults to a sibling of the source repository.",
    )
    parser.add_argument(
        "--deploy-script",
        help="Path to ops/deploy.ps1; defaults to <workspace>/ops/deploy.ps1.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("sync-version", help="Write the Skill version into config.yaml.")
    subparsers.add_parser("check", help="Run local tests and SkillHub dry-run.")
    subparsers.add_parser("preflight", help="Require committed files and check deployment safety.")
    release_parser = subparsers.add_parser(
        "release",
        help="Push and publish the Skill, then deploy the synchronized backend config.",
    )
    release_parser.add_argument("--confirm", metavar=DEPLOY_CONFIRMATION)
    return parser


def main() -> int:
    configure_output()
    args = build_parser().parse_args()
    try:
        source_repo = find_repo_root()
        if args.command == "sync-version":
            sync_version(source_repo, args.downstream_repo)
        elif args.command == "check":
            run_checks(source_repo, args.downstream_repo)
        elif args.command == "preflight":
            deploy_preflight(source_repo, args.downstream_repo, args.deploy_script)
        elif args.command == "release":
            release(source_repo, args.downstream_repo, args.deploy_script, args.confirm)
        else:
            raise ReleaseError(f"Unsupported command: {args.command}")
    except ReleaseError as exc:
        print(f"[contextweave] error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
