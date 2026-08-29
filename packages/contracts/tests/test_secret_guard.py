"""raw secret guard — secret처럼 보이는 키 아래에는 secret:// ref만 존재할 수 있다."""

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.eval_case import EvalCase
from agentcanvas_contracts.node_registry import NodeType, PortSpec
from agentcanvas_contracts.refs import no_raw_secrets
from agentcanvas_contracts.release import ReleaseManifest
from agentcanvas_contracts.run_events import RunEvent
from pydantic import ValidationError
from test_agent_spec import MINIMAL_SPEC
from test_release import CLOUD_RELEASE

RAW = "sk-live-1234567890"
REF = "secret://openai-api-key"


@pytest.mark.parametrize(
    "payload",
    [
        {"api_keys": [RAW]},
        {"secret": {"value": RAW}},
        {"token": {"nested": {"deeper": [RAW]}}},
        {"credentials": [{"password": RAW}]},
        {"api_key": [REF, RAW]},
    ],
)
def test_secret_like_key_rejects_raw_string_anywhere_below_it(payload):
    with pytest.raises(ValueError) as exc:
        no_raw_secrets(payload)
    assert "secret://" in str(exc.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"api_keys": [REF, REF]},
        {"secret": {"value": REF}},
        {"token": {"rotation_days": 30, "value": REF}},
        {"tokens": []},
        {"max_tokens": 2000},
    ],
)
def test_secret_like_key_accepts_refs_and_non_string_leaves(payload):
    assert no_raw_secrets(payload) == payload


def test_agent_spec_schemas_are_guarded():
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(
            {
                **MINIMAL_SPEC,
                "input_schema": {"properties": {"api_key": {"default": RAW}}},
            }
        )
    assert "secret://" in str(exc.value)


def test_agent_spec_state_schema_is_guarded():
    with pytest.raises(ValidationError):
        AgentSpec.model_validate({**MINIMAL_SPEC, "state_schema": {"token": RAW}})


def test_node_config_is_guarded():
    with pytest.raises(ValidationError):
        Node.model_validate(
            {
                "id": "n",
                "type": "llm.agent",
                "position": {"x": 0, "y": 0},
                "config": {"api_keys": [RAW]},
            }
        )


def test_node_type_config_schema_is_guarded():
    with pytest.raises(ValidationError):
        NodeType.model_validate(
            {
                "type": "custom.echo",
                "version": "1.0",
                "runtime": "langgraph.python",
                "display_name": "Echo",
                "plain_description": "그대로 내보낸다.",
                "ports": {"inputs": [], "outputs": []},
                "config_schema": {"properties": {"token": {"const": RAW}}},
            }
        )


def test_port_schema_is_guarded():
    with pytest.raises(ValidationError):
        PortSpec.model_validate({"id": "input", "schema": {"api_key": RAW}})


def test_run_event_payload_is_guarded():
    with pytest.raises(ValidationError):
        RunEvent.model_validate(
            {
                "seq": 0,
                "run_id": "run_1",
                "event_type": "tool.requested",
                "timestamp": "2026-08-01T00:00:00Z",
                "spec_revision": "sha256:" + "a" * 64,
                "payload": {"headers": {"authorization_token": RAW}},
            }
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"node_id": "lookup", "input": {"api_key": RAW}},
        {"node_id": "lookup", "result": {"credentials": {"password": RAW}}},
        {"node_id": "lookup", "error": {"message": "failed", "token": RAW}},
    ],
)
def test_what_a_tool_run_writes_down_is_guarded(payload):
    """도구가 남기는 것에도 열쇠 실값은 실릴 수 없다 — 건넨 값도, 받은 값도, 실패한 까닭도."""
    with pytest.raises(ValidationError) as exc:
        RunEvent.model_validate(
            {
                "seq": 3,
                "run_id": "run_1",
                "event_type": "tool.completed",
                "timestamp": "2026-08-01T00:00:00Z",
                "spec_revision": "sha256:" + "a" * 64,
                "payload": payload,
            }
        )
    assert "secret://" in str(exc.value)


def test_a_key_hidden_in_a_field_that_does_not_look_like_one_is_not_caught():
    """이 guard가 지키는 범위를 정직하게 적어 둔다 — 못 막는 자리를 막는 척하지 않는다.

    guard는 **이름이 열쇠처럼 생긴 자리**만 본다. 사람이 도구의 입력 값이나 주소에 열쇠를
    직접 박아 넣으면 그 자리는 이름이 평범해 여기서 걸리지 않는다. 서버가 관리하는 열쇠
    (`secret://` 이름 → Authorization 헤더)는 이벤트에 실릴 길 자체가 없다 —
    그 보장은 어댑터 쪽 시험(test_http_tool)이 함께 진다.
    """
    slipped = RunEvent.model_validate(
        {
            "seq": 3,
            "run_id": "run_1",
            "event_type": "tool.requested",
            "timestamp": "2026-08-01T00:00:00Z",
            "spec_revision": "sha256:" + "a" * 64,
            "payload": {"node_id": "lookup", "input": {"q": RAW}},
        }
    )

    assert slipped.payload["input"]["q"] == RAW


def test_a_tool_run_may_write_down_the_name_of_a_key():
    """이름은 실값이 아니다 — 어느 열쇠를 쓰는지는 적힐 수 있다."""
    event = RunEvent.model_validate(
        {
            "seq": 3,
            "run_id": "run_1",
            "event_type": "tool.requested",
            "timestamp": "2026-08-01T00:00:00Z",
            "spec_revision": "sha256:" + "a" * 64,
            "payload": {"node_id": "lookup", "auth": REF},
        }
    )
    assert event.payload["auth"] == REF


def test_eval_case_input_is_guarded():
    with pytest.raises(ValidationError):
        EvalCase.model_validate(
            {
                "id": "case_1",
                "title": "제목",
                "input": {"api_key": RAW},
                "expected_phrases": ["반갑"],
            }
        )


def test_release_manifest_dict_fields_are_guarded():
    with pytest.raises(ValidationError):
        ReleaseManifest.model_validate(
            {**CLOUD_RELEASE, "prompt_revisions": {"api_key": RAW}}
        )
