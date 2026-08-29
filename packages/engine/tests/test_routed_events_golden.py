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


# ── 도구가 실제로 일하는 실행 (API_TOOLS P3a) ────────────────────────────────

TOOL_DIR = Path(__file__).resolve().parents[3] / "examples/tool-run"
TOOL_RUN_ID = "run_tool_example"


def tool_example_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((TOOL_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def committed_tool_run() -> list[RunEvent]:
    raw = json.loads((TOOL_DIR / "run_events.json").read_text(encoding="utf-8"))
    return [RunEvent.model_validate(event) for event in raw]


def remade_tool_run() -> list[RunEvent]:
    """결정론 대역으로 돌린 도구 실행 — 진짜 HTTP는 부르지 않으므로 언제나 같다."""
    return routed_run(
        tool_example_spec(),
        run_id=TOOL_RUN_ID,
        started_at=STARTED_AT,
        input={"query": {"text": "asthma in adults"}},
    )


class TestTheToolRunThatWasWrittenDown:
    def test_the_graph_is_one_nobody_has_to_fix_first(self):
        assert [
            issue for issue in validate_graph(tool_example_spec()) if issue.severity
        ] == []

    def test_its_revision_matches_what_is_written_in_it(self):
        spec = tool_example_spec()
        assert spec.revision == spec.computed_revision()

    def test_the_runtime_remakes_it_event_for_event(self):
        assert remade_tool_run() == committed_tool_run()

    def test_the_three_tool_events_are_written_down_in_order(self):
        kinds = [event.event_type for event in committed_tool_run()]

        assert [kind for kind in kinds if kind.value.startswith("tool.")] == [
            EventType.TOOL_POLICY_CHECKED,
            EventType.TOOL_REQUESTED,
            EventType.TOOL_COMPLETED,
        ]

    def test_what_came_back_says_how_much_was_carried_on(self):
        completed = next(
            event
            for event in committed_tool_run()
            if event.event_type is EventType.TOOL_COMPLETED
        )

        assert completed.payload["ok"] is True
        assert completed.payload["original_chars"] == completed.payload["loaded_chars"]

    def test_no_key_is_written_down_anywhere_in_the_run(self):
        """열쇠는 이름으로만 산다 — 기록 어디에도 실값이 없다 (계약 guard와 짝을 이룬다)."""
        written = json.dumps(
            [json.loads(event.model_dump_json()) for event in committed_tool_run()]
        )

        assert "secret://" not in written
        assert "Bearer" not in written

    def test_only_the_way_that_was_taken_flowed(self):
        """잘 끝난 실행에서는 어그러진 갈래가 흐르지 않는다 — 나간 포트로 갈린다."""
        events = committed_tool_run()
        worked = {event.node_id for event in events if event.node_id is not None}

        assert "answer" in worked
        # error 포트에 매달린 노드는 차례를 받지 못한다 — 그 갈래는 결판났고 흐르지 않았다.
        assert "trouble" not in worked
