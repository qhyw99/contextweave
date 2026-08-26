import json
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = REPO_ROOT / "skills" / "skillhub-safe-release" / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import contextweave_release as context_release  # noqa: E402
import skillhub_release  # noqa: E402


def _skill(version="1.2.7"):
    return skillhub_release.Skill(
        path=REPO_ROOT / "skills" / "interactive-architecture-diagram",
        slug="contextweave-interactive-architecture",
        version=version,
        display_name="架构图一键生成",
    )


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_public_skill_version_matches_namespaced_search_result(monkeypatch):
    payload = {
        "results": [
            {
                "slug": "@user_bddf3fe6/contextweave-interactive-architecture",
                "publicSlug": "contextweave-interactive-architecture",
                "version": "1.2.7",
            }
        ]
    }
    monkeypatch.setattr(
        context_release.urllib.request,
        "urlopen",
        lambda request, timeout: FakeResponse(payload),
    )

    assert context_release.public_skill_version(_skill()) == "1.2.7"


def test_wait_for_approval_sleeps_until_exact_version_is_public(monkeypatch):
    observed = iter(["1.2.6", "1.2.6", "1.2.7"])
    sleeps = []
    monkeypatch.setattr(
        context_release, "public_skill_version", lambda skill: next(observed)
    )
    monkeypatch.setattr(context_release.time, "sleep", sleeps.append)

    context_release.wait_for_skillhub_approval(
        _skill(), timeout_seconds=30, interval_seconds=2
    )

    assert sleeps == [2, 2]


def test_release_orders_publish_approval_wait_and_deploy(tmp_path, monkeypatch):
    events = []
    skill = _skill()
    deploy_script = tmp_path / "deploy.ps1"
    deploy_script.write_text("", encoding="utf-8")

    monkeypatch.setattr(
        context_release,
        "publication_preflight",
        lambda source_repo, downstream_path: skill,
    )
    monkeypatch.setattr(
        context_release, "public_skill_version", lambda current_skill: "1.2.6"
    )
    monkeypatch.setattr(
        context_release,
        "wait_for_skillhub_approval",
        lambda current_skill, **kwargs: events.append("approval"),
    )
    monkeypatch.setattr(
        context_release,
        "deploy_preflight",
        lambda source_repo, downstream_path, deploy_path: events.append("preflight"),
    )
    monkeypatch.setattr(
        context_release, "resolve_deploy_script", lambda source_repo, raw_path: deploy_script
    )
    monkeypatch.setattr(context_release, "powershell_executable", lambda: "pwsh")

    def fake_run(command, *, cwd):
        if "skillhub_release.py" in " ".join(str(part) for part in command):
            events.append("publish")
        elif str(deploy_script) in command:
            events.append("deploy")

    monkeypatch.setattr(context_release, "run", fake_run)

    context_release.release(
        tmp_path,
        None,
        str(deploy_script),
        context_release.DEPLOY_CONFIRMATION,
        30,
        2,
    )

    assert events == ["publish", "approval", "preflight", "deploy"]


def test_release_requires_explicit_confirmation(tmp_path):
    with pytest.raises(skillhub_release.ReleaseError):
        context_release.release(tmp_path, None, None, None, 30, 2)


def test_publish_accepts_official_status_only_success_payload(tmp_path, monkeypatch):
    skill = _skill()
    payload = {
        "skillId": "skill-123",
        "version": skill.version,
        "status": "pending_review",
        "publicUrl": "https://skillhub.cn/skills/contextweave-interactive-architecture",
    }
    completed = subprocess.CompletedProcess(
        args=["skillhub", "publish"],
        returncode=0,
        stdout=json.dumps(payload),
    )
    monkeypatch.setattr(skillhub_release, "skillhub_command", lambda: ["skillhub"])
    monkeypatch.setattr(skillhub_release, "run", lambda *args, **kwargs: completed)

    assert skillhub_release.run_skillhub(tmp_path, skill, dry_run=False) == payload
