#!/usr/bin/env python3
"""Gate SkillHub releases behind dry-run validation and human approval."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence


DEFAULT_HOST = "https://api.skillhub.cn"
DETAIL_BASE_URL = "https://skillhub.cn/skills"
CONFIRMATION = "push-and-publish"
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class ReleaseError(RuntimeError):
    """An actionable release gate failure."""


@dataclass(frozen=True)
class Skill:
    path: Path
    slug: str
    version: str
    display_name: str

    @property
    def identity(self) -> str:
        return f"{self.slug}@{self.version}"


def configure_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def command_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["PYTHONIOENCODING"] = "utf-8"
    return environment


def run(
    command: Sequence[str],
    *,
    cwd: Path,
    check: bool = True,
    show_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        env=command_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    output = (result.stdout or "").rstrip()
    if show_output and output:
        print(output)
    if check and result.returncode != 0:
        rendered = shlex.join(str(part) for part in command)
        detail = output or f"exit code {result.returncode}"
        raise ReleaseError(f"Command failed: {rendered}\n{detail}")
    return result


def find_repo_root() -> Path:
    result = run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=Path.cwd(),
        check=False,
    )
    if result.returncode != 0:
        raise ReleaseError("Run this command from inside the target Git repository.")
    return Path(result.stdout.strip()).resolve()


def git(repo: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run(["git", *arguments], cwd=repo, check=check)


def parse_scalar(raw_value: str) -> str:
    value = raw_value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_front_matter(skill_file: Path) -> dict[str, str]:
    try:
        lines = skill_file.read_text(encoding="utf-8-sig").splitlines()
    except OSError as exc:
        raise ReleaseError(f"Cannot read {skill_file}: {exc}") from exc

    if not lines or lines[0].strip() != "---":
        raise ReleaseError(f"{skill_file} must start with YAML front matter.")

    try:
        end_index = next(
            index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"
        )
    except StopIteration as exc:
        raise ReleaseError(f"{skill_file} has unterminated YAML front matter.") from exc

    metadata: dict[str, str] = {}
    for line in lines[1:end_index]:
        if not line or line[0].isspace() or ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        metadata[key.strip()] = parse_scalar(raw_value)
    return metadata


def resolve_skill(repo: Path, raw_path: str | Path) -> Skill:
    path = Path(raw_path)
    if not path.is_absolute():
        path = repo / path
    path = path.resolve()
    if path.name == "SKILL.md":
        path = path.parent

    try:
        path.relative_to(repo)
    except ValueError as exc:
        raise ReleaseError(f"Skill path must be inside {repo}: {path}") from exc

    skill_file = path / "SKILL.md"
    if not skill_file.is_file():
        raise ReleaseError(f"Missing SKILL.md in {path}")

    metadata = parse_front_matter(skill_file)
    missing = [key for key in ("slug", "version", "displayName") if not metadata.get(key)]
    if missing:
        raise ReleaseError(f"{skill_file} is missing required fields: {', '.join(missing)}")

    slug = metadata["slug"]
    version = metadata["version"]
    display_name = metadata["displayName"]
    if not 2 <= len(slug) <= 128 or not SLUG_RE.fullmatch(slug):
        raise ReleaseError(f"Invalid SkillHub slug in {skill_file}: {slug!r}")
    if not SEMVER_RE.fullmatch(version):
        raise ReleaseError(f"Invalid SemVer in {skill_file}: {version!r}")

    return Skill(path=path, slug=slug, version=version, display_name=display_name)


def resolve_skills(repo: Path, raw_paths: Iterable[str | Path]) -> list[Skill]:
    skills: list[Skill] = []
    seen: set[Path] = set()
    for raw_path in raw_paths:
        skill = resolve_skill(repo, raw_path)
        if skill.path not in seen:
            skills.append(skill)
            seen.add(skill.path)
    if not skills:
        raise ReleaseError("No Skill directories were selected.")
    return skills


def skillhub_command() -> list[str]:
    configured = os.environ.get("SKILLHUB_CLI", "").strip()
    if configured:
        return shlex.split(configured, posix=os.name != "nt")

    executable = shutil.which("skillhub")
    if executable:
        return [executable]

    installed_script = Path.home() / ".skillhub" / "skills_store_cli.py"
    if installed_script.is_file():
        return [sys.executable, str(installed_script)]

    raise ReleaseError(
        "Official SkillHub CLI was not found. Install it from "
        "https://skillhub.cn/install/skillhub.md and log in before retrying."
    )


def parse_json_output(output: str) -> dict[str, object]:
    for line in reversed(output.splitlines()):
        candidate = line.strip()
        if not candidate.startswith("{"):
            continue
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ReleaseError(f"SkillHub CLI did not return JSON:\n{output.rstrip()}")


def run_skillhub(repo: Path, skill: Skill, *, dry_run: bool) -> dict[str, object]:
    command = [
        *skillhub_command(),
        "publish",
        str(skill.path),
        "--host",
        os.environ.get("SKILLHUB_HOST", DEFAULT_HOST),
        "--json",
    ]
    if dry_run:
        command.append("--dry-run")

    print(f"[skillhub] {'dry-run' if dry_run else 'publish'} {skill.identity}")
    result = run(command, cwd=repo, check=False)
    if result.returncode != 0:
        raise ReleaseError(
            f"SkillHub {'dry-run' if dry_run else 'publish'} failed for {skill.identity}:\n"
            f"{result.stdout.rstrip()}"
        )

    payload = parse_json_output(result.stdout)
    if payload.get("slug") != skill.slug or payload.get("version") != skill.version:
        raise ReleaseError(
            f"SkillHub returned unexpected identity for {skill.identity}: {payload}"
        )
    if not dry_run and payload.get("ok") is not True:
        raise ReleaseError(f"SkillHub did not confirm publication for {skill.identity}: {payload}")
    return payload


def dry_run_all(repo: Path, skills: Sequence[Skill]) -> None:
    for skill in skills:
        run_skillhub(repo, skill, dry_run=True)
    print("[skillhub] dry-run passed: " + ", ".join(skill.identity for skill in skills))


def staged_skill_folders(repo: Path) -> list[str]:
    result = git(
        repo,
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACMR",
        "-z",
    )
    folders: set[str] = set()
    for raw_name in result.stdout.split("\0"):
        parts = Path(raw_name).parts
        if len(parts) >= 2 and parts[0] == "skills":
            folders.add(parts[1])
    return sorted(folders)


def staged_skills(repo: Path) -> tuple[tempfile.TemporaryDirectory[str], list[Skill]]:
    folders = staged_skill_folders(repo)
    if not folders:
        raise ReleaseError("NO_STAGED_SKILLS")

    temporary = tempfile.TemporaryDirectory(prefix="skillhub-staged-")
    snapshot = Path(temporary.name)
    prefix = snapshot.as_posix().rstrip("/") + "/"
    git(repo, "checkout-index", "--all", "--force", f"--prefix={prefix}")

    candidates = [snapshot / "skills" / folder for folder in folders]
    existing = [path for path in candidates if (path / "SKILL.md").is_file()]
    if not existing:
        temporary.cleanup()
        raise ReleaseError("NO_STAGED_SKILLS")

    return temporary, resolve_skills(snapshot, existing)


def install_hook(repo: Path) -> None:
    hook = repo / ".githooks" / "pre-commit"
    if not hook.is_file():
        raise ReleaseError(f"Tracked hook is missing: {hook}")

    current_mode = hook.stat().st_mode
    hook.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    git(repo, "config", "--local", "core.hooksPath", ".githooks")
    git(repo, "config", "--local", "skillhub.python", Path(sys.executable).as_posix())
    print(f"[skillhub] pre-commit hook enabled for {repo}")
    print(f"[skillhub] Python: {Path(sys.executable).as_posix()}")


def ensure_skill_paths_clean(repo: Path, skills: Sequence[Skill]) -> None:
    relative_paths = [skill.path.relative_to(repo).as_posix() for skill in skills]
    result = git(
        repo,
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        *relative_paths,
    )
    if result.stdout.strip():
        raise ReleaseError(
            "Target Skill files must be committed before release:\n" + result.stdout.rstrip()
        )


def approve_release(skills: Sequence[Skill], supplied_confirmation: str | None) -> None:
    summary = ", ".join(skill.identity for skill in skills)
    print(f"[skillhub] ready to run git push, then publish: {summary}")
    if supplied_confirmation is not None:
        if supplied_confirmation != CONFIRMATION:
            raise ReleaseError("Invalid release confirmation.")
        return

    if not sys.stdin.isatty():
        raise ReleaseError(
            "Human confirmation is required. After explicit approval, rerun with "
            f"--confirm {CONFIRMATION}."
        )
    try:
        entered = input(f'Type "{CONFIRMATION}" to continue: ').strip()
    except EOFError as exc:
        raise ReleaseError(
            "Human confirmation is required. After explicit approval, rerun with "
            f"--confirm {CONFIRMATION}."
        ) from exc
    if entered != CONFIRMATION:
        raise ReleaseError("Release cancelled; no remote changes were made.")


def release(repo: Path, skills: Sequence[Skill], confirmation: str | None) -> None:
    ensure_skill_paths_clean(repo, skills)
    dry_run_all(repo, skills)
    approve_release(skills, confirmation)

    print("[skillhub] pushing current Git branch")
    run(["git", "push"], cwd=repo, show_output=True)

    for skill in skills:
        payload = run_skillhub(repo, skill, dry_run=False)
        statuses = ", ".join(
            f"{key}={payload[key]}"
            for key in ("reviewStatus", "contentAuditStatus", "securityScanStatus")
            if key in payload
        )
        suffix = f" ({statuses})" if statuses else ""
        print(f"[skillhub] published {skill.identity}: {DETAIL_BASE_URL}/{skill.slug}{suffix}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate staged Skills and gate Git push plus SkillHub publication."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("install-hook", help="Enable the repository-local pre-commit hook.")
    subparsers.add_parser("hook", help=argparse.SUPPRESS)

    dry_run_parser = subparsers.add_parser("dry-run", help="Validate Skill directories without publishing.")
    dry_run_parser.add_argument("paths", nargs="+", help="Skill directories or SKILL.md paths.")

    release_parser = subparsers.add_parser(
        "release", help="Dry-run, confirm, git push, then publish Skill directories."
    )
    release_parser.add_argument("paths", nargs="+", help="Skill directories or SKILL.md paths.")
    release_parser.add_argument(
        "--confirm",
        metavar=CONFIRMATION,
        help="Use only after a human explicitly approves both remote actions.",
    )
    return parser


def main() -> int:
    configure_output()
    args = build_parser().parse_args()
    try:
        repo = find_repo_root()
        if args.command == "install-hook":
            install_hook(repo)
        elif args.command == "hook":
            try:
                temporary, skills = staged_skills(repo)
            except ReleaseError as exc:
                if str(exc) == "NO_STAGED_SKILLS":
                    print("[skillhub] no staged Skill changes; dry-run skipped")
                    return 0
                raise
            try:
                dry_run_all(repo, skills)
            finally:
                temporary.cleanup()
        elif args.command == "dry-run":
            dry_run_all(repo, resolve_skills(repo, args.paths))
        elif args.command == "release":
            release(repo, resolve_skills(repo, args.paths), args.confirm)
        else:
            raise ReleaseError(f"Unsupported command: {args.command}")
    except ReleaseError as exc:
        print(f"[skillhub] error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
