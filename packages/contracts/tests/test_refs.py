import re

import pytest
from agentcanvas_contracts.refs import (
    EndUserRef,
    McpRef,
    ModelRef,
    PromptRef,
    SchemaRef,
    SecretRef,
    ServerRef,
    SkillRef,
    no_raw_secrets,
)
from pydantic import BaseModel, ValidationError


class PromptHolder(BaseModel):
    ref: PromptRef


class ServerHolder(BaseModel):
    ref: ServerRef


class ModelHolder(BaseModel):
    ref: ModelRef


class SchemaHolder(BaseModel):
    ref: SchemaRef


class McpHolder(BaseModel):
    ref: McpRef


class SecretHolder(BaseModel):
    ref: SecretRef


def test_prompt_ref_keeps_name_and_revision():
    holder = PromptHolder(ref="prompt://clinical@7")
    assert holder.ref == "prompt://clinical@7"


def test_prompt_ref_rejects_wrong_scheme_in_words_a_person_can_act_on():
    """사용자(HTTP 422 포함)가 보는 말은 raw 정규식이 아니라 형태를 설명하는 문장이다."""
    with pytest.raises(ValidationError) as exc:
        PromptHolder(ref="model://clinical")
    assert "must look like prompt://name[@revision]" in str(exc.value)


@pytest.mark.parametrize("ref", ["mcp://a\n", "mcp://a ", " mcp://a", "mcp://a\nb"])
def test_ref_rejects_anything_around_the_reference(ref):
    """개행·공백이 붙은 값은 ref가 아니다 — 파이썬과 JSON Schema가 같게 판정해야 한다."""
    with pytest.raises(ValidationError):
        McpHolder(ref=ref)


@pytest.mark.parametrize(
    "ref",
    [
        "mcp://a",
        "mcp://a@1",
        "mcp://a\n",
        "mcp://a ",
        " mcp://a",
        "clinical-reference",
        "secret://a",
        "mcp://",
    ],
)
def test_the_exported_pattern_accepts_exactly_what_the_model_accepts(ref):
    """JSON Schema에 실은 pattern과 런타임 판정이 같은 집합을 뜻한다."""
    pattern = McpHolder.model_json_schema()["properties"]["ref"]["pattern"]
    accepted_by_schema = re.fullmatch(pattern, ref) is not None

    try:
        McpHolder(ref=ref)
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True

    assert accepted_by_schema is accepted_by_model


def test_model_ref_accepts_scheme_without_revision():
    assert ModelHolder(ref="model://default").ref == "model://default"


def test_schema_ref_accepts_revision():
    assert (
        SchemaHolder(ref="schema://triage-result@1").ref == "schema://triage-result@1"
    )


def test_mcp_ref_accepts_server():
    assert McpHolder(ref="mcp://clinical-reference").ref == "mcp://clinical-reference"


@pytest.mark.parametrize("ref", ["api://clinical-ref", "api://clinical-ref@2"])
def test_server_ref_accepts_an_api_server(ref):
    assert ServerHolder(ref=ref).ref == ref


@pytest.mark.parametrize("ref", ["mcp://clinical-reference", "mcp://a@1"])
def test_server_ref_still_accepts_an_mcp_server(ref):
    """도구 서버가 둘이 되어도 이미 저장된 mcp 바인딩은 그대로 읽힌다."""
    assert ServerHolder(ref=ref).ref == ref


def test_server_ref_rejects_another_scheme_in_words_a_person_can_act_on():
    with pytest.raises(ValidationError) as exc:
        ServerHolder(ref="http://clinical-ref")
    assert "must look like mcp://name[@revision] or api://name[@revision]" in str(
        exc.value
    )


@pytest.mark.parametrize(
    "ref",
    [
        "mcp://a",
        "api://a@1",
        "api://a\n",
        " api://a",
        "http://a",
        "clinical-reference",
        "api://",
    ],
)
def test_the_server_pattern_accepts_exactly_what_the_model_accepts(ref):
    """두 scheme을 하나의 정규식으로 실었어도 런타임 판정과 같은 집합을 뜻한다."""
    pattern = ServerHolder.model_json_schema()["properties"]["ref"]["pattern"]
    accepted_by_schema = re.fullmatch(pattern, ref) is not None

    try:
        ServerHolder(ref=ref)
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True

    assert accepted_by_schema is accepted_by_model


def test_ref_rejects_empty_name():
    with pytest.raises(ValidationError):
        ModelHolder(ref="model://")


def test_secret_ref_requires_secret_scheme():
    assert SecretHolder(ref="secret://openai-api-key").ref == "secret://openai-api-key"
    with pytest.raises(ValidationError):
        SecretHolder(ref="sk-live-1234567890")


@pytest.mark.parametrize(
    "field_name", ["secret", "api_key", "token", "apiKey", "access_token"]
)
def test_no_raw_secrets_rejects_raw_string_under_secret_like_field(field_name):
    with pytest.raises(ValueError) as exc:
        no_raw_secrets({field_name: "sk-live-1234567890"})
    assert field_name in str(exc.value)


def test_no_raw_secrets_allows_secret_ref_value():
    payload = {"api_key": "secret://openai-api-key"}
    assert no_raw_secrets(payload) == payload


def test_no_raw_secrets_walks_nested_containers():
    with pytest.raises(ValueError):
        no_raw_secrets({"providers": [{"auth": {"token": "raw-value"}}]})


def test_no_raw_secrets_ignores_non_secret_fields():
    payload = {"model_ref": "model://default", "max_turns": 4}
    assert no_raw_secrets(payload) == payload


class SkillHolder(BaseModel):
    ref: SkillRef


def test_skill_ref_keeps_name_and_revision():
    assert SkillHolder(ref="skill://plain-answer@1").ref == "skill://plain-answer@1"


def test_skill_ref_rejects_another_scheme_in_words_a_person_can_act_on():
    with pytest.raises(ValidationError) as exc:
        SkillHolder(ref="prompt://plain-answer")
    assert "must look like skill://name[@revision]" in str(exc.value)


@pytest.mark.parametrize(
    "ref",
    [
        "skill://plain-answer",
        "skill://a@1",
        "skill://",
        "skill://a\n",
        "plain-answer",
        "prompt://a",
    ],
)
def test_the_skill_pattern_accepts_exactly_what_the_model_accepts(ref):
    """JSON Schema에 실은 pattern과 런타임 판정이 같은 집합을 뜻한다."""
    pattern = SkillHolder.model_json_schema()["properties"]["ref"]["pattern"]
    accepted_by_schema = re.fullmatch(pattern, ref) is not None
    try:
        SkillHolder(ref=ref)
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True
    assert accepted_by_schema is accepted_by_model


class EndUserHolder(BaseModel):
    ref: EndUserRef


def test_end_user_ref_points_by_name_only():
    assert EndUserHolder(ref="end-user://alice").ref == "end-user://alice"


def test_end_user_ref_rejects_a_raw_string():
    with pytest.raises(ValidationError):
        EndUserHolder(ref="alice@example.com")


def test_end_user_ref_rejects_another_scheme():
    with pytest.raises(ValidationError):
        EndUserHolder(ref="model://alice")


@pytest.mark.parametrize(
    "ref",
    ["end-user://alice", "end-user://a@1", "end-user://", "alice", "model://alice"],
)
def test_the_end_user_pattern_accepts_exactly_what_the_model_accepts(ref):
    """JSON Schema에 실은 pattern과 런타임 판정이 같은 집합을 뜻한다."""
    pattern = EndUserHolder.model_json_schema()["properties"]["ref"]["pattern"]
    accepted_by_schema = re.fullmatch(pattern, ref) is not None
    try:
        EndUserHolder(ref=ref)
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True
    assert accepted_by_schema is accepted_by_model
