"""예시 실행이 남긴 이벤트가 계약대로인가.

studio(TS)의 `fakeRun`이 만들어 낸 `examples/basic-agent/run_events.json`을 양쪽 언어가 함께 읽는다.
TS는 같은 spec에서 같은 이벤트가 다시 나오는지를, 여기서는 그 이벤트가 RunEvent 계약을
만족하고 seq가 되돌아가지 않는지를 판정한다 (detach_reachability.json과 같은 방식).
"""

from __future__ import annotations

import json
from pathlib import Path

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run_events import EventType, RunEvent, assert_monotonic_seq

EXAMPLE_DIR = Path(__file__).resolve().parents[3] / "examples/basic-agent"


def load_events() -> list[RunEvent]:
    raw = json.loads((EXAMPLE_DIR / "run_events.json").read_text(encoding="utf-8"))
    return [RunEvent.model_validate(event) for event in raw]


def load_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((EXAMPLE_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def test_every_recorded_event_is_a_run_event():
    assert len(load_events()) > 0


def test_seq_never_goes_back():
    assert_monotonic_seq(load_events())


def test_the_run_is_wrapped_between_a_start_and_an_end():
    events = load_events()
    assert events[0].event_type is EventType.RUN_STARTED
    assert events[-1].event_type is EventType.RUN_COMPLETED


def test_every_event_carries_the_revision_of_the_example_spec():
    revisions = {event.spec_revision for event in load_events()}
    assert revisions == {load_spec().revision}


def test_every_node_of_the_example_spec_is_started_once():
    started = [
        event.node_id
        for event in load_events()
        if event.event_type is EventType.NODE_STARTED
    ]
    assert sorted(filter(None, started)) == sorted(
        node.id for node in load_spec().nodes
    )


def test_events_are_stamped_in_the_order_they_happened():
    timestamps = [event.timestamp for event in load_events()]
    assert timestamps == sorted(timestamps)
