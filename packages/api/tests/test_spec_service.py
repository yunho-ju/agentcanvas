"""판을 매기는 규칙 — 이 판은 언제나 '이 그래프의 다음 판'이다.

HTTP를 거치지 않고 규칙만 본다. 규칙이 서비스 안에 있어야 부르는 쪽이 실수해도 어긋나지 않는다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.service import SaveRefused, SpecService, SpecView
from agentcanvas_contracts.agent_spec import AgentSpec

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def spec(**overrides) -> AgentSpec:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return AgentSpec.model_validate({**raw, **overrides})


def at() -> datetime:
    return datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


@pytest.fixture
def service() -> SpecService:
    return SpecService(InMemorySpecStore(), clock=at)


def saved(outcome: SpecView | SaveRefused) -> SpecView:
    assert isinstance(outcome, SpecView), outcome
    return outcome


def latest_revision(service: SpecService, spec_id: str) -> str:
    latest = service.latest(spec_id)
    assert latest is not None
    return latest.spec.revision


def test_the_first_save_is_the_first_version(service: SpecService):
    assert saved(service.create(spec(id="a"))).stored.spec.version == 1


def test_a_graph_that_is_already_saved_is_not_saved_over(service: SpecService):
    service.create(spec(id="a", name="처음"))

    refused = service.create(spec(id="a", name="나중"))

    assert isinstance(refused, SaveRefused)
    assert refused.reason == "already_saved"
    latest = service.latest("a")
    assert latest is not None and latest.spec.name == "처음"


def test_a_graph_nobody_saved_cannot_be_changed(service: SpecService):
    refused = service.update("nowhere", spec(id="nowhere"))

    assert isinstance(refused, SaveRefused)
    assert refused.reason == "unknown"


def test_a_graph_is_never_changed_by_another_graphs_content(service: SpecService):
    service.create(spec(id="a"))

    refused = service.update("a", spec(id="b"), latest_revision(service, "a"))

    assert isinstance(refused, SaveRefused)
    assert refused.reason == "id_mismatch"
    assert service.revisions("a") == service.revisions("a")[:1]


def test_a_graph_does_not_inherit_another_graphs_version_numbers(service: SpecService):
    """옆 그래프가 여섯 판을 지나왔어도, 이 그래프의 다음 판은 두 번째다."""
    service.create(spec(id="a"))
    for step in range(5):
        saved(
            service.update(
                "a",
                spec(id="a", name=f"고친 판 {step}"),
                latest_revision(service, "a"),
            )
        )
    service.create(spec(id="b"))

    outcome = saved(
        service.update("b", spec(id="b", name="고친 판"), latest_revision(service, "b"))
    )

    assert outcome.stored.spec.version == 2
    assert [entry.version for entry in service.revisions("b")] == [2, 1]
    assert [entry.version for entry in service.revisions("a")] == [6, 5, 4, 3, 2, 1]


def test_a_stale_revision_is_refused_without_appending(service: SpecService):
    first = saved(service.create(spec(id="a")))
    saved(
        service.update("a", spec(id="a", name="먼저 저장"), first.stored.spec.revision)
    )

    refused = service.update(
        "a", spec(id="a", name="나중 저장"), first.stored.spec.revision
    )

    assert isinstance(refused, SaveRefused)
    assert refused.reason == "stale_revision"
    assert service.latest("a").spec.name == "먼저 저장"
    assert [entry.version for entry in service.revisions("a")] == [2, 1]
