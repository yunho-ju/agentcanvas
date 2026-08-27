"""실행 하나(Run)와, 그 실행이 지금 어떤 상태인가.

상태는 Run에 적혀 있지 않다 — 실행의 원본은 이벤트이고, 상태는 거기서 파생된다 (설계 §6).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from agentcanvas_contracts.run import ApprovalAnswer, Run, RunStatus, run_status
from agentcanvas_contracts.run_events import EventType, RunEvent
from pydantic import ValidationError

REVISION = "sha256:" + "0" * 64
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def a_run(**changes) -> Run:
    return Run(
        **{
            "id": "run_1",
            "spec_id": "clinical-assistant",
            "spec_revision": REVISION,
            "created_at": STARTED_AT,
            **changes,
        }
    )


def an_event(event_type: EventType, seq: int = 0) -> RunEvent:
    return RunEvent(
        seq=seq,
        run_id="run_1",
        event_type=event_type,
        timestamp=STARTED_AT,
        spec_revision=REVISION,
        payload={},
    )


def test_a_run_names_the_graph_and_the_revision_it_ran():
    run = a_run()

    assert run.spec_id == "clinical-assistant"
    assert run.spec_revision == REVISION


def test_a_run_without_a_name_is_not_a_run():
    with pytest.raises(ValidationError):
        a_run(id="")


def test_a_run_belongs_to_a_revision_that_looks_like_one():
    with pytest.raises(ValidationError):
        a_run(spec_revision="whatever")


def test_a_run_does_not_carry_a_status_of_its_own():
    assert "status" not in Run.model_fields


def test_a_run_that_has_said_nothing_yet_is_running():
    assert run_status([]) is RunStatus.RUNNING


def test_a_run_held_at_a_valve_is_paused():
    events = [an_event(EventType.RUN_STARTED), an_event(EventType.RUN_PAUSED, 1)]

    assert run_status(events) is RunStatus.PAUSED


def test_a_run_that_was_let_go_is_running_again():
    events = [an_event(EventType.RUN_PAUSED), an_event(EventType.RUN_RESUMED, 1)]

    assert run_status(events) is RunStatus.RUNNING


def test_a_run_that_reached_its_end_is_completed():
    events = [an_event(EventType.RUN_STARTED), an_event(EventType.RUN_COMPLETED, 1)]

    assert run_status(events) is RunStatus.COMPLETED


def test_a_run_that_broke_is_failed():
    events = [an_event(EventType.RUN_STARTED), an_event(EventType.RUN_FAILED, 1)]

    assert run_status(events) is RunStatus.FAILED


def test_the_status_is_read_from_the_last_event_not_the_first():
    events = [an_event(EventType.RUN_PAUSED), an_event(EventType.NODE_STARTED, 1)]

    assert run_status(events) is RunStatus.RUNNING


def test_an_approval_may_carry_what_the_person_filled_in():
    answer = ApprovalAnswer(approved=True, values={"comment": "looks right"})

    assert answer.values == {"comment": "looks right"}


def test_an_answer_says_nothing_more_than_yes_by_default():
    assert ApprovalAnswer(approved=False).values is None


def test_turning_it_down_cannot_carry_values():
    with pytest.raises(ValidationError):
        ApprovalAnswer(approved=False, values={"comment": "no"})
