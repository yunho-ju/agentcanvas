"""갈림길 실행기가 만드는 이벤트를 파일로 못 박아 둔다 — 갈래마다 하나씩.

`examples/branching-agent`에는 갈림길(어느 길로 갈 것인가)과 사람 확인(승인·거절)이 함께 있다.
같은 그래프라도 **판단과 답에 따라 다른 갈래**가 돈다는 것이 이 파일들이 고정하는 사실이다.
파일은 대조 기준이므로 손으로 고쳐 쓰지 않는다 (실행기가 바뀌면 다시 만들어 diff를 본다).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import (
    RouteAsk,
    judged_by,
    resume_routed_run,
    routed_run,
)
from agentcanvas_engine.validator import validate_graph

EXAMPLE_DIR = Path(__file__).resolve().parents[3] / "examples/branching-agent"

RUN_ID = "run_branching"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def example_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((EXAMPLE_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def committed(name: str) -> list[RunEvent]:
    raw = json.loads((EXAMPLE_DIR / name).read_text(encoding="utf-8"))
    return [RunEvent.model_validate(event) for event in raw]


def picks(way: str):
    """언제나 같은 길을 고르는 판단 주체 — 골든은 언제나 같은 갈래를 돈다."""

    def judge(ask: RouteAsk) -> str:
        return way

    return judged_by(judge)


def held_at_the_gate(spec: AgentSpec) -> list[RunEvent]:
    return routed_run(
        spec, run_id=RUN_ID, started_at=STARTED_AT, model=picks("clinical")
    )


def remade(name: str) -> list[RunEvent]:
    """파일 이름이 말하는 갈래를 지금 실행기로 다시 만든다."""
    spec = example_spec()
    if name == "run_events.simple.json":
        return routed_run(
            spec, run_id=RUN_ID, started_at=STARTED_AT, model=picks("simple")
        )
    approved = name == "run_events.approved.json"
    return resume_routed_run(
        spec,
        held_at_the_gate(spec),
        ApprovalAnswer(approved=approved),
        model=picks("clinical"),
    )


GOLDEN = [
    "run_events.approved.json",
    "run_events.rejected.json",
    "run_events.simple.json",
]


class TestTheGraphTheGoldenRunsWereRunOn:
    def test_it_is_a_graph_nobody_has_to_fix_first(self):
        assert validate_graph(example_spec()) == []

    def test_its_revision_matches_what_is_written_in_it(self):
        spec = example_spec()

        assert spec.revision == spec.computed_revision()


class TestTheRunsThatWereWrittenDown:
    @pytest.mark.parametrize("name", GOLDEN)
    def test_the_runtime_remakes_them_event_for_event(self, name: str):
        assert remade(name) == committed(name)

    def test_the_approved_way_and_the_refused_way_end_up_in_different_places(self):
        approved = worked(committed("run_events.approved.json"))
        rejected = worked(committed("run_events.rejected.json"))

        assert approved[-1] == "output"
        assert rejected[-1] == "revise"

    def test_the_way_the_judge_picked_is_written_down_in_every_run(self):
        for name, way in (
            ("run_events.approved.json", "clinical"),
            ("run_events.simple.json", "simple"),
        ):
            decided = next(
                event
                for event in committed(name)
                if event.event_type is EventType.DECISION_RECORDED
            )

            assert decided.payload["route"] == way

    def test_the_simple_way_never_asks_a_person_anything(self):
        events = committed("run_events.simple.json")

        assert worked(events) == ["input", "triage", "quick-answer", "output"]
        assert events[-1].event_type is EventType.RUN_COMPLETED


def worked(events: list[RunEvent]) -> list[str | None]:
    return [
        event.node_id for event in events if event.event_type is EventType.NODE_STARTED
    ]
