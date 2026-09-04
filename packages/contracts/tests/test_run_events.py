from datetime import UTC, datetime, timedelta, timezone

import pytest
from agentcanvas_contracts.run_events import EventType, RunEvent, assert_monotonic_seq
from pydantic import ValidationError

SPEC_REVISION = "sha256:" + "a" * 64

REQUIRED_EVENT_TYPES = [
    "run.started",
    "node.queued",
    "node.started",
    "prompt.compiled",
    "llm.requested",
    "llm.completed",
    "decision.recorded",
    "tool.policy_checked",
    "tool.requested",
    "tool.completed",
    "state.patch",
    "checkpoint.created",
    "human.approval_requested",
    "run.paused",
    "run.resumed",
    "node.completed",
    "node.failed",
    "run.completed",
    "run.failed",
]


def event(seq: int = 0, **overrides) -> RunEvent:
    payload = {
        "seq": seq,
        "run_id": "run_123",
        "event_type": "run.started",
        "timestamp": "2026-08-01T12:30:04.120Z",
        "spec_revision": SPEC_REVISION,
        "payload": {},
    }
    return RunEvent.model_validate({**payload, **overrides})


def test_event_type_enum_covers_the_required_events_in_order():
    assert [member.value for member in EventType] == REQUIRED_EVENT_TYPES


@pytest.mark.parametrize("event_type", REQUIRED_EVENT_TYPES)
def test_every_required_event_type_can_be_instantiated(event_type):
    assert event(event_type=event_type).event_type is EventType(event_type)


def test_node_id_is_optional():
    assert event().node_id is None
    assert event(node_id="clinical-agent").node_id == "clinical-agent"


def test_turn_says_which_round_inside_one_node_this_belongs_to():
    assert event().turn is None
    assert event(turn=2).turn == 2


def test_negative_turn_is_rejected():
    with pytest.raises(ValidationError) as exc:
        event(turn=-1)
    assert exc.value.errors()[0]["loc"] == ("turn",)


def test_timestamp_is_parsed_as_utc():
    assert event().timestamp == datetime(2026, 8, 1, 12, 30, 4, 120000, tzinfo=UTC)


def test_naive_timestamp_is_rejected():
    with pytest.raises(ValidationError) as exc:
        event(timestamp="2026-08-01T12:30:04.120")
    assert exc.value.errors()[0]["loc"] == ("timestamp",)


def test_non_utc_timestamp_is_rejected():
    with pytest.raises(ValidationError):
        event(timestamp=datetime(2026, 8, 1, tzinfo=timezone(timedelta(hours=9))))


def test_negative_seq_is_rejected():
    with pytest.raises(ValidationError) as exc:
        event(seq=-1)
    assert exc.value.errors()[0]["loc"] == ("seq",)


def test_spec_revision_must_be_sha256_digest():
    with pytest.raises(ValidationError) as exc:
        event(spec_revision="sha256:example")
    assert exc.value.errors()[0]["loc"] == ("spec_revision",)


def test_payload_rejects_raw_secret_value():
    with pytest.raises(ValidationError) as exc:
        event(payload={"headers": {"api_key": "sk-live-1234567890"}})
    assert "secret://" in str(exc.value)


def test_prompt_compiled_payload_is_kept_verbatim():
    payload = {
        "prompt_ref": "prompt://clinical@7",
        "blocks": [{"id": "system-role"}],
        "total_tokens": 2592,
    }
    assert event(event_type="prompt.compiled", payload=payload).payload == payload


def test_assert_monotonic_seq_accepts_increasing_sequence():
    assert_monotonic_seq([event(seq=0), event(seq=1), event(seq=42)])


def test_assert_monotonic_seq_accepts_empty_sequence():
    assert_monotonic_seq([])


def test_assert_monotonic_seq_rejects_repeated_seq():
    with pytest.raises(ValueError) as exc:
        assert_monotonic_seq([event(seq=1), event(seq=1)])
    assert "1" in str(exc.value)


def test_assert_monotonic_seq_rejects_decreasing_seq():
    with pytest.raises(ValueError):
        assert_monotonic_seq([event(seq=2), event(seq=1)])
