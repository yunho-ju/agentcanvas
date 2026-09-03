import hashlib
from datetime import UTC, datetime

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.release import (
    ModelSnapshot,
    ReleaseManifest,
    skill_snapshot_of,
)
from pydantic import ValidationError

CLOUD_RELEASE = {
    "release_id": "release-2026-08-01-004",
    "graph_revision": "graph:r42",
    "prompt_revisions": {
        "system": "prompt:clinical-system@17",
        "tool_router": "prompt:tool-router@8",
    },
    "model_snapshot": {"provider": "openai", "model": "pinned-model-version"},
    "tool_registry_snapshot": "tools:r19",
    "mcp_policy_snapshot": "mcp-policy:r6",
    "eval_suite_snapshot": "eval-suite:safety-v12",
    "approval": {
        "status": "approved",
        "approved_by": ["reviewer-id"],
        "approved_at": "2026-08-01T00:00:00Z",
    },
}


def test_design_document_release_example_loads():
    manifest = ReleaseManifest.model_validate(CLOUD_RELEASE)
    assert manifest.release_id == "release-2026-08-01-004"
    assert manifest.prompt_revisions["system"] == "prompt:clinical-system@17"
    assert manifest.approval.approved_by == ["reviewer-id"]
    assert manifest.approval.approved_at == datetime(2026, 8, 1, tzinfo=UTC)


def test_release_round_trips_through_json():
    manifest = ReleaseManifest.model_validate(CLOUD_RELEASE)
    dumped = manifest.model_dump(mode="json", exclude_defaults=True)
    assert ReleaseManifest.model_validate(dumped).model_dump(
        mode="json"
    ) == manifest.model_dump(mode="json")


def test_cloud_model_snapshot_needs_no_quantization_or_digest():
    snapshot = ModelSnapshot.model_validate(
        {"provider": "openai", "model": "pinned-model-version"}
    )
    assert snapshot.quantization is None
    assert snapshot.digest is None


def test_local_model_snapshot_records_quantization_and_digest():
    snapshot = ModelSnapshot.model_validate(
        {
            "provider": "ollama",
            "model": "llama-3.3-70b",
            "quantization": "Q4_K_M",
            "digest": "sha256:" + "b" * 64,
        }
    )
    assert snapshot.quantization == "Q4_K_M"
    assert snapshot.digest == "sha256:" + "b" * 64


def test_missing_model_snapshot_is_reported_by_field():
    payload = {
        key: value for key, value in CLOUD_RELEASE.items() if key != "model_snapshot"
    }
    with pytest.raises(ValidationError) as exc:
        ReleaseManifest.model_validate(payload)
    error = exc.value.errors()[0]
    assert error["loc"] == ("model_snapshot",)
    assert error["type"] == "missing"


def test_approval_requires_utc_timestamp():
    with pytest.raises(ValidationError) as exc:
        ReleaseManifest.model_validate(
            {
                **CLOUD_RELEASE,
                "approval": {
                    **CLOUD_RELEASE["approval"],
                    "approved_at": "2026-08-01T00:00:00",
                },
            }
        )
    assert exc.value.errors()[0]["loc"] == ("approval", "approved_at")


def a_spec_holding(*names: str) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "released",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {"type": "object"},
            "state_schema": {"type": "object"},
            "nodes": [],
            "edges": [],
            "skills": [
                {
                    "ref": f"skill://{name}@1",
                    "name": name,
                    "description": f"Use when {name} is what the answer needs.",
                    "body": f"Do what {name} asks.\n",
                }
                for name in names
            ],
        }
    )


def test_a_release_that_says_nothing_about_skills_stays_the_release_it_was():
    """옛 manifest는 skill을 몰랐다 — 그 문서가 그대로 읽히고 그대로 다시 적힌다."""
    manifest = ReleaseManifest.model_validate(CLOUD_RELEASE)

    assert manifest.skill_snapshot == {}
    assert manifest.model_dump(mode="json", exclude_defaults=True) == CLOUD_RELEASE


def test_the_snapshot_pins_the_body_of_every_skill_the_document_holds():
    snapshot = skill_snapshot_of(a_spec_holding("plain-answer"))
    body = "Do what plain-answer asks.\n"

    assert snapshot == {
        "skill://plain-answer@1": "sha256:"
        + hashlib.sha256(body.encode("utf-8")).hexdigest()
    }


def test_a_document_holding_no_skill_pins_nothing():
    assert skill_snapshot_of(a_spec_holding()) == {}


def test_two_skills_that_say_different_things_are_pinned_differently():
    snapshot = skill_snapshot_of(a_spec_holding("first", "second"))

    assert len(set(snapshot.values())) == 2
