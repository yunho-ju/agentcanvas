"""ToolDef — 도구 하나를 코드로 적는 계약 (docs/vision/api-tools.md).

바인딩이 어떤 서버를 쓰든(도구를 MCP로 부르든 HTTP로 부르든) 도구의 인터페이스는
같다. 다른 것은 "부르는 방법"(call)과 "받은 것을 얼마나 실을지"(result_handling)뿐이다.
"""

import json
from pathlib import Path

import jsonschema
import pytest
from agentcanvas_contracts.agent_spec import AgentSpec, ResourceBinding
from agentcanvas_contracts.tool_def import ToolDef
from pydantic import ValidationError
from test_agent_spec import spec_dict

HTTP_TOOL = {
    "name": "get_article",
    "plain_description": {
        "ko": "글 번호를 주면 그 글의 내용을 돌려줍니다.",
        "en": "Give it an article number and it returns the article.",
    },
    "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}},
    "output_schema": {"type": "object", "properties": {"body": {"type": "string"}}},
    "timeout_ms": 5000,
    "call": {
        "transport": "http",
        "method": "GET",
        "url_template": "https://api.example.com/articles/{id}",
        "auth": "secret://clinical-api-key",
    },
}


def tool_dict(**overrides):
    return {**HTTP_TOOL, **overrides}


def binding_dict(**overrides):
    return {
        "id": "clinical-reference",
        "kind": "http.api",
        "server_ref": "api://clinical-ref",
        "allowed_tools": [],
        "approval_policy": "read_only_auto",
        **overrides,
    }


def spec_with(binding: dict) -> AgentSpec:
    return AgentSpec.model_validate(spec_dict(resources=[binding]))


def test_binding_carries_a_http_tool():
    binding = ResourceBinding.model_validate(binding_dict(tools=[HTTP_TOOL]))
    tool = binding.tools[0]
    assert tool.name == "get_article"
    assert tool.call.url_template == "https://api.example.com/articles/{id}"


def test_binding_without_tools_holds_none():
    assert ResourceBinding.model_validate(binding_dict()).tools == []


def test_binding_carries_an_mcp_tool():
    binding = ResourceBinding.model_validate(
        binding_dict(
            kind="mcp.toolset",
            server_ref="mcp://clinical-reference",
            tools=[tool_dict(call={"transport": "mcp", "remote_name": "getArticle"})],
        )
    )
    assert binding.tools[0].call.remote_name == "getArticle"


def test_an_unknown_transport_is_rejected_at_the_call_field():
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(
            tool_dict(call={"transport": "carrier-pigeon", "remote_name": "x"})
        )
    error = exc.value.errors()[0]
    assert error["loc"] == ("call",)
    assert error["type"] == "union_tag_invalid"
    assert "transport" in error["msg"]


def test_a_tool_without_a_call_is_rejected():
    payload = tool_dict()
    del payload["call"]
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(payload)
    error = exc.value.errors()[0]
    assert error["loc"] == ("call",)
    assert error["type"] == "missing"


def test_the_transport_decides_which_fields_a_call_needs():
    """판별 필드가 정해지면 그 종류의 필드만 요구한다 — mcp 호출에 url은 없다."""
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(
            tool_dict(call={"transport": "mcp", "url_template": "https://example.com"})
        )
    assert {error["loc"][-1] for error in exc.value.errors()} == {
        "remote_name",
        "url_template",
    }


def test_a_tool_that_says_nothing_carries_the_whole_answer():
    """작은 응답이 대부분이다 — 아무 말도 없으면 받은 것을 그대로 싣는다."""
    assert ToolDef.model_validate(tool_dict()).result_handling.mode == "full"


@pytest.mark.parametrize(
    "result_handling",
    [
        {"mode": "full"},
        {"mode": "sections", "section_param": "sections"},
        {"mode": "digest", "model_ref": "model://default", "max_chars": 2000},
        {
            "mode": "retrieve",
            "query_param": "question",
            "top_k": 3,
            "chunk": {"by": "section", "size": 1200},
        },
    ],
    ids=["full", "sections", "digest", "retrieve"],
)
def test_every_way_of_loading_an_answer_is_accepted(result_handling):
    tool = ToolDef.model_validate(tool_dict(result_handling=result_handling))
    assert tool.result_handling.model_dump(mode="json") == result_handling


@pytest.mark.parametrize(
    "result_handling, missing",
    [
        ({"mode": "sections"}, "section_param"),
        ({"mode": "digest", "max_chars": 2000}, "model_ref"),
        ({"mode": "digest", "model_ref": "model://default"}, "max_chars"),
        (
            {"mode": "retrieve", "top_k": 3, "chunk": {"by": "chars", "size": 800}},
            "query_param",
        ),
        ({"mode": "retrieve", "query_param": "q", "top_k": 3}, "chunk"),
    ],
)
def test_a_way_of_loading_an_answer_must_bring_its_own_settings(
    result_handling, missing
):
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(tool_dict(result_handling=result_handling))
    assert exc.value.errors()[0]["loc"][-1] == missing


def test_an_unknown_way_of_loading_an_answer_is_rejected():
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(tool_dict(result_handling={"mode": "telepathy"}))
    assert exc.value.errors()[0]["type"] == "union_tag_invalid"


@pytest.mark.parametrize(
    "result_handling",
    [
        {"mode": "digest", "model_ref": "model://default", "max_chars": 0},
        {
            "mode": "retrieve",
            "query_param": "question",
            "top_k": 0,
            "chunk": {"by": "chars", "size": 800},
        },
        {
            "mode": "retrieve",
            "query_param": "question",
            "top_k": 3,
            "chunk": {"by": "chars", "size": 0},
        },
    ],
    ids=["max_chars", "top_k", "chunk_size"],
)
def test_a_size_that_loads_nothing_is_rejected(result_handling):
    with pytest.raises(ValidationError):
        ToolDef.model_validate(tool_dict(result_handling=result_handling))


def test_two_tools_with_the_same_name_in_one_binding_are_rejected():
    """노드는 이름으로 도구를 고른다 — 한 바인딩 안에 같은 이름이 둘이면 고를 수 없다."""
    with pytest.raises(ValidationError) as exc:
        ResourceBinding.model_validate(
            binding_dict(tools=[HTTP_TOOL, tool_dict(timeout_ms=1000)])
        )
    assert "get_article" in str(exc.value)


def test_the_same_tool_name_in_another_binding_is_allowed():
    """이름은 바인딩 안에서만 유일하면 된다 — 서버가 다르면 같은 이름을 쓸 수 있다."""
    spec = AgentSpec.model_validate(
        spec_dict(
            resources=[
                binding_dict(tools=[HTTP_TOOL]),
                binding_dict(id="other-reference", tools=[HTTP_TOOL]),
            ]
        )
    )
    assert [tool.name for binding in spec.resources for tool in binding.tools] == [
        "get_article",
        "get_article",
    ]


@pytest.mark.parametrize("auth", ["secret://clinical-api-key", None])
def test_a_http_call_names_its_key_instead_of_carrying_it(auth):
    call = {**HTTP_TOOL["call"], "auth": auth}
    assert ToolDef.model_validate(tool_dict(call=call)).call.auth == auth


def test_a_http_call_refuses_a_raw_key():
    call = {**HTTP_TOOL["call"], "auth": "sk-live-1234567890"}
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(tool_dict(call=call))
    assert exc.value.errors()[0]["loc"][-1] == "auth"
    assert "must look like secret://name[@revision]" in str(exc.value)


def test_a_free_form_schema_cannot_smuggle_a_raw_key():
    """input_schema는 자유 dict다 — 기존 raw secret 금지 규칙이 여기에도 걸린다."""
    with pytest.raises(ValidationError) as exc:
        ToolDef.model_validate(
            tool_dict(
                input_schema={
                    "type": "object",
                    "properties": {"api_key": {"default": "sk-live-1234567890"}},
                }
            )
        )
    assert "secret://" in str(exc.value)


TOOL_DEF_SCHEMA = {
    "$defs": json.loads(
        (Path(__file__).resolve().parents[1] / "json_schema/agent_spec.json").read_text(
            encoding="utf-8"
        )
    )["$defs"],
    "$ref": "#/$defs/ToolDef",
}


@pytest.mark.parametrize(
    "result_handling",
    [
        {},
        {"mode": "full"},
        {"mode": "full", "max_chars": 10},
        {"mode": "sections", "section_param": "sections"},
        {"mode": "sections"},
        {"mode": "digest", "model_ref": "model://default", "max_chars": 2000},
        {"mode": "digest", "model_ref": "model://default"},
        {"mode": "digest", "model_ref": "not-a-ref", "max_chars": 2000},
        {"mode": "digest", "model_ref": "model://default", "max_chars": 0},
        {
            "mode": "retrieve",
            "query_param": "question",
            "top_k": 3,
            "chunk": {"by": "section", "size": 1200},
        },
        {"mode": "retrieve", "query_param": "question", "top_k": 3},
        {
            "mode": "retrieve",
            "query_param": "question",
            "top_k": 0,
            "chunk": {"by": "chars", "size": 800},
        },
        {"mode": "telepathy"},
    ],
)
def test_the_published_schema_accepts_exactly_what_the_model_accepts(result_handling):
    """커밋된 스키마와 파이썬이 같은 집합을 뜻한다 — 스키마만 보는 소비자가 서버에게 거절당하지 않는다."""
    payload = tool_dict(result_handling=result_handling)
    try:
        jsonschema.validate(instance=payload, schema=TOOL_DEF_SCHEMA)
    except jsonschema.ValidationError:
        accepted_by_schema = False
    else:
        accepted_by_schema = True

    try:
        ToolDef.model_validate(payload)
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True

    assert accepted_by_schema is accepted_by_model


EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "examples"


def example_spec_paths() -> list[Path]:
    return sorted(
        path
        for path in EXAMPLES_DIR.rglob("*.json")
        if isinstance(raw := json.loads(path.read_text(encoding="utf-8")), dict)
        and raw.get("schema_version") == "agent.spec/v1"
    )


def test_an_example_document_carries_a_connection_with_tools():
    """예제 하나는 도구를 든 연결을 갖는다 — 도구 고르기가 빈 목록으로 시작하지 않는다."""
    specs = [
        AgentSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))
        for path in example_spec_paths()
        if path.name == "agent_spec.json"
    ]
    assert len(specs) >= 2
    assert [
        tool.name
        for spec in specs
        for binding in spec.resources
        for tool in binding.tools
    ]


def test_changing_a_tool_makes_a_different_revision():
    """도구도 spec의 내용이다 — 도구만 바꿔도 다른 판이 된다."""
    original = spec_with(binding_dict(tools=[HTTP_TOOL]))
    changed = spec_with(
        binding_dict(tools=[tool_dict(timeout_ms=HTTP_TOOL["timeout_ms"] + 1)])
    )
    assert changed.computed_revision() != original.computed_revision()
