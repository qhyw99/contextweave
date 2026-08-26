#!/usr/bin/env python3
"""Coordinate ContextWeave SkillHub publication with the backend version gate."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Sequence

from skillhub_release import (
    CONFIRMATION as SKILLHUB_CONFIRMATION,
    ReleaseError,
    Skill,
    find_repo_root,
    install_hook as install_skillhub_hook,
    resolve_skill,
)


SOURCE_BRANCH = "main"
SOURCE_SKILL = Path("skills/interactive-architecture-diagram")
DOWNSTREAM_REPO_NAME = "interleaved-thinking"
DOWNSTREAM_BRANCH = "v0.0.1"
DOWNSTREAM_CONFIG = Path("config.yaml")
DEPLOY_CONFIRMATION = "push-publish-and-deploy"
AUTO_RELEASE_CONFIG = "skillhub.contextweaveAutoRelease"
AUTO_TIMEOUT_CONFIG = "skillhub.contextweaveApprovalTimeout"
AUTO_INTERVAL_CONFIG = "skillhub.contextweaveApprovalInterval"
DEFAULT_APPROVAL_TIMEOUT = 1800
DEFAULT_APPROVAL_INTERVAL = 30
DEFAULT_SEARCH_URL = "https://api.skillhub.cn/api/v1/search"
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


def git_optional_output(repo: Path, *arguments: str) -> str | None:
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
        return None
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


def public_skill_version(
    skill: Skill,
    *,
    search_url: str | None = None,
    timeout: int = 10,
) -> str | None:
    base_url = search_url or os.environ.get("SKILLHUB_SEARCH_URL") or DEFAULT_SEARCH_URL
    query = urllib.parse.urlencode({"q": skill.slug, "limit": 20})
    url = f"{base_url}?{query}"
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "contextweave-release/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=max(1, timeout)) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise ReleaseError(f"Cannot query SkillHub approval status: {exc}") from exc

    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        raise ReleaseError("SkillHub search response does not contain a results list")

    for item in results:
        if not isinstance(item, dict):
            continue
        namespace = item.get("namespace") if isinstance(item.get("namespace"), dict) else {}
        canonical_slug = str(item.get("slug") or "").strip()
        public_slug = str(
            item.get("publicSlug") or namespace.get("publicSlug") or ""
        ).strip()
        if (
            public_slug == skill.slug
            or canonical_slug == skill.slug
            or canonical_slug.endswith(f"/{skill.slug}")
        ):
            version = str(item.get("version") or "").strip()
            return version or None
    return None


def wait_for_skillhub_approval(
    skill: Skill,
    *,
    timeout_seconds: int,
    interval_seconds: int,
) -> None:
    if timeout_seconds <= 0:
        raise ReleaseError("Approval timeout must be greater than zero")
    if interval_seconds <= 0:
        raise ReleaseError("Approval polling interval must be greater than zero")

    started = time.monotonic()
    while True:
        elapsed = int(time.monotonic() - started)
        try:
            visible_version = public_skill_version(skill)
            if visible_version == skill.version:
                print(
                    f"[contextweave] SkillHub approval passed: {skill.identity} "
                    f"(visible after {elapsed}s)",
                    flush=True,
                )
                return
            observed = visible_version or "not visible"
        except ReleaseError as exc:
            observed = str(exc)

        remaining = timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise ReleaseError(
                f"Timed out after {timeout_seconds}s waiting for SkillHub approval of "
                f"{skill.identity}; last observed state: {observed}"
            )
        sleep_seconds = min(interval_seconds, max(1, int(remaining)))
        print(
            f"[contextweave] waiting for SkillHub approval: {skill.identity}; "
            f"public version={observed}; retry in {sleep_seconds}s",
            flush=True,
        )
        time.sleep(sleep_seconds)


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


def publication_preflight(source_repo: Path, downstream_path: str | None) -> Skill:
    downstream_repo, config_file, _ = context(source_repo, downstream_path)
    ensure_path_clean(source_repo, SOURCE_SKILL)
    ensure_path_clean(downstream_repo, DOWNSTREAM_CONFIG)
    run_checks(source_repo, downstream_path)
    return resolve_skill(source_repo, SOURCE_SKILL)


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


def commit_touches_source_skill(source_repo: Path) -> bool:
    changed = git_output(
        source_repo,
        "show",
        "--format=",
        "--name-only",
        "HEAD",
        "--",
        SOURCE_SKILL.as_posix(),
    )
    return bool(changed.strip())


def auto_release_enabled(source_repo: Path) -> bool:
    value = git_optional_output(source_repo, "config", "--bool", "--get", AUTO_RELEASE_CONFIG)
    return value == "true"


def configured_positive_int(source_repo: Path, key: str, default: int) -> int:
    value = git_optional_output(source_repo, "config", "--get", key)
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ReleaseError(f"Git config {key} must be a positive integer, found {value!r}") from exc
    if parsed <= 0:
        raise ReleaseError(f"Git config {key} must be a positive integer, found {parsed}")
    return parsed


def enable_auto_release(source_repo: Path, timeout_seconds: int, interval_seconds: int) -> None:
    post_commit = source_repo / ".githooks" / "post-commit"
    if not post_commit.is_file():
        raise ReleaseError(f"Tracked post-commit hook is missing: {post_commit}")
    post_commit.chmod(
        post_commit.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    )
    install_skillhub_hook(source_repo)
    git_output(source_repo, "config", "--local", AUTO_RELEASE_CONFIG, "true")
    git_output(source_repo, "config", "--local", AUTO_TIMEOUT_CONFIG, str(timeout_seconds))
    git_output(source_repo, "config", "--local", AUTO_INTERVAL_CONFIG, str(interval_seconds))
    print(
        "[contextweave] automatic post-commit release enabled: "
        f"timeout={timeout_seconds}s interval={interval_seconds}s"
    )


def disable_auto_release(source_repo: Path) -> None:
    git_output(source_repo, "config", "--local", AUTO_RELEASE_CONFIG, "false")
    print("[contextweave] automatic post-commit release disabled")


def sync_and_commit_downstream_version(source_repo: Path, downstream_path: str | None) -> None:
    downstream_repo, config_file, skill_version = context(source_repo, downstream_path)
    ensure_path_clean(downstream_repo, DOWNSTREAM_CONFIG)
    changed = write_required_skill_version(config_file, skill_version)
    if not changed:
        print(f"[contextweave] downstream version already committed: {skill_version}")
        return

    relative_config = DOWNSTREAM_CONFIG.as_posix()
    run(["git", "add", "--", relative_config], cwd=downstream_repo)
    run(
        [
            "git",
            "commit",
            "-m",
            f"chore: require ContextWeave skill {skill_version}",
            "--",
            relative_config,
        ],
        cwd=downstream_repo,
    )
    print(
        f"[contextweave] committed downstream version: "
        f"{downstream_repo.name}/{relative_config} -> {skill_version}"
    )


def release(
    source_repo: Path,
    downstream_path: str | None,
    deploy_path: str | None,
    confirmation: str | None,
    approval_timeout: int,
    approval_interval: int,
) -> None:
    if confirmation != DEPLOY_CONFIRMATION:
        raise ReleaseError(
            "Explicit approval is required for Git push, SkillHub publication, and backend deployment. "
            f"After approval, rerun with --confirm {DEPLOY_CONFIRMATION}."
        )

    skill = publication_preflight(source_repo, downstream_path)
    release_script = Path(__file__).with_name("skillhub_release.py")
    visible_version = public_skill_version(skill)
    if visible_version == skill.version:
        print(f"[contextweave] SkillHub already approved {skill.identity}; publish skipped")
        run(["git", "push"], cwd=source_repo)
    else:
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

    wait_for_skillhub_approval(
        skill,
        timeout_seconds=approval_timeout,
        interval_seconds=approval_interval,
    )
    deploy_preflight(source_repo, downstream_path, deploy_path)

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


def auto_release(
    source_repo: Path,
    downstream_path: str | None,
    deploy_path: str | None,
) -> None:
    if not auto_release_enabled(source_repo):
        raise ReleaseError(
            "Automatic release is disabled. Run enable-auto-release after explicitly approving "
            "future post-commit pushes, publications, and deployments."
        )
    if not commit_touches_source_skill(source_repo):
        print("[contextweave] latest commit does not change the ContextWeave Skill; release skipped")
        return

    skill = resolve_skill(source_repo, SOURCE_SKILL)
    visible_version = public_skill_version(skill)
    if visible_version == skill.version:
        raise ReleaseError(
            f"{skill.identity} is already public. Bump the Skill version before committing changes."
        )

    sync_and_commit_downstream_version(source_repo, downstream_path)
    release(
        source_repo,
        downstream_path,
        deploy_path,
        DEPLOY_CONFIRMATION,
        configured_positive_int(
            source_repo, AUTO_TIMEOUT_CONFIG, DEFAULT_APPROVAL_TIMEOUT
        ),
        configured_positive_int(
            source_repo, AUTO_INTERVAL_CONFIG, DEFAULT_APPROVAL_INTERVAL
        ),
    )


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
    enable_parser = subparsers.add_parser(
        "enable-auto-release",
        help="Enable the opt-in post-commit ContextWeave release workflow.",
    )
    enable_parser.add_argument(
        "--approval-timeout", type=int, default=DEFAULT_APPROVAL_TIMEOUT
    )
    enable_parser.add_argument(
        "--approval-interval", type=int, default=DEFAULT_APPROVAL_INTERVAL
    )
    subparsers.add_parser("disable-auto-release", help="Disable post-commit releases.")
    subparsers.add_parser("auto-release", help=argparse.SUPPRESS)
    wait_parser = subparsers.add_parser(
        "wait-for-approval",
        help="Wait until the current Skill version is publicly approved by SkillHub.",
    )
    wait_parser.add_argument(
        "--approval-timeout", type=int, default=DEFAULT_APPROVAL_TIMEOUT
    )
    wait_parser.add_argument(
        "--approval-interval", type=int, default=DEFAULT_APPROVAL_INTERVAL
    )
    release_parser = subparsers.add_parser(
        "release",
        help="Push and publish the Skill, then deploy the synchronized backend config.",
    )
    release_parser.add_argument("--confirm", metavar=DEPLOY_CONFIRMATION)
    release_parser.add_argument(
        "--approval-timeout", type=int, default=DEFAULT_APPROVAL_TIMEOUT
    )
    release_parser.add_argument(
        "--approval-interval", type=int, default=DEFAULT_APPROVAL_INTERVAL
    )
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
        elif args.command == "enable-auto-release":
            enable_auto_release(source_repo, args.approval_timeout, args.approval_interval)
        elif args.command == "disable-auto-release":
            disable_auto_release(source_repo)
        elif args.command == "auto-release":
            auto_release(source_repo, args.downstream_repo, args.deploy_script)
        elif args.command == "wait-for-approval":
            skill = resolve_skill(source_repo, SOURCE_SKILL)
            wait_for_skillhub_approval(
                skill,
                timeout_seconds=args.approval_timeout,
                interval_seconds=args.approval_interval,
            )
        elif args.command == "release":
            release(
                source_repo,
                args.downstream_repo,
                args.deploy_script,
                args.confirm,
                args.approval_timeout,
                args.approval_interval,
            )
        else:
            raise ReleaseError(f"Unsupported command: {args.command}")
    except ReleaseError as exc:
        print(f"[contextweave] error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
