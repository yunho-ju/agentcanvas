from __future__ import annotations

import json

from agentcanvas_adapters.architect import ArchitectBalked, ArchitectSaid
from agentcanvas_adapters.tool_wrapper import (
    TOOL_WRAPPER_ALLOWED_OPERATIONS,
    TOOL_WRAPPER_PROMPT_REF,
    ToolSource,
    ToolWrapRequest,
    tool_wrapper_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec, AgentStatus, Node, Position
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

OPENAPI_SOURCE = """
openapi: 3.1.0
paths:
  /articles/search:
    get:
      summary: Search articles
"""


def a_spec() -> AgentSpec:
    draft = AgentSpec(
        schema_version="agent.spec/v1",
        id="demo",
        name=None,
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object"},
        state_schema={"type": "object"},
        nodes=[
            Node(
                id="input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"question": "input.question"}},
            )
        ],
        edges=[],
        resources=[],
        execution=None,
    )
    return draft.model_copy(update={"revision": draft.computed_revision()})


def a_request(
    source_kind: ToolSource = ToolSource.OPENAPI,
    source: str = OPENAPI_SOURCE,
) -> ToolWrapRequest:
    return ToolWrapRequest(
        base_spec=a_spec(),
        source_kind=source_kind,
        source=source,
        model_ref="model://openai",
    )


def resource_answer(base_revision: str, op: str = "add_resource") -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": op,
                    "resource": {
                        "id": "article-api",
                        "kind": "http.api",
                        "server_ref": "api://article-api",
                        "approval_policy": "read_only_auto",
                        "tools": [
                            {
                                "name": "search_articles",
                                "plain_description": {
                                    "ko": "글을 검색한다.",
                                    "en": "Searches articles.",
                                },
                                "input_schema": {
                                    "type": "object",
                                    "properties": {"query": {"type": "string"}},
                                },
                                "output_schema": {"type": "object"},
                                "timeout_ms": 8000,
                                "call": {
                                    "transport": "http",
                                    "method": "GET",
                                    "url_template": (
                                        "https://api.example.com/articles/search"
                                    ),
                                    "auth": "secret://article-api-key",
                                },
                            }
                        ],
                    },
                }
            ],
        }
    )


def asked_with(text: str) -> tuple[list[ModelAsk], object]:
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(input_tokens=3, output_tokens=5, text=text)

    return seen, tool_wrapper_from(model)


def test_the_wrapper_asks_with_its_own_prompt_and_the_patch_schema():
    spec = a_spec()
    seen, wraps = asked_with(resource_answer(spec.revision))

    wraps(a_request())

    ask = seen[0]
    assert ask.prompt_ref == TOOL_WRAPPER_PROMPT_REF
    assert ask.response_schema == AgentSpecPatch.model_json_schema()


def test_the_prompt_carries_what_was_pasted_and_the_exact_base_revision():
    spec = a_spec()
    seen, wraps = asked_with(resource_answer(spec.revision))

    wraps(a_request())

    instruction = seen[0].instruction
    assert OPENAPI_SOURCE.strip() in instruction
    assert spec.revision in instruction


def test_the_prompt_only_offers_adding_a_connection():
    spec = a_spec()
    seen, wraps = asked_with(resource_answer(spec.revision))

    wraps(a_request())

    instruction = seen[0].instruction
    assert TOOL_WRAPPER_ALLOWED_OPERATIONS == ("add_resource",)
    assert "add_resource" in instruction
    assert "remove_resource" not in instruction
    assert "add_node" not in instruction


def test_the_prompt_says_the_key_itself_never_comes_back():
    spec = a_spec()
    seen, wraps = asked_with(resource_answer(spec.revision))

    wraps(a_request())

    assert "secret://" in seen[0].instruction


def test_each_kind_of_paste_is_told_apart_in_the_prompt():
    spec = a_spec()
    said = resource_answer(spec.revision)
    instructions = []
    for kind in ToolSource:
        seen, wraps = asked_with(said)
        wraps(a_request(source_kind=kind, source="whatever the person pasted"))
        instructions.append(seen[0].instruction)

    assert len(set(instructions)) == len(instructions)


def test_a_connection_the_model_proposed_arrives_as_a_patch():
    spec = a_spec()
    _seen, wraps = asked_with(resource_answer(spec.revision))

    result = wraps(a_request())

    assert isinstance(result, ArchitectSaid)
    assert [operation.op for operation in result.patch.operations] == ["add_resource"]


def test_taking_an_existing_connection_away_is_outside_the_table():
    """표는 더하기 하나다 — 지우기·갈아 끼우기가 오면 통째로 물러선다."""
    spec = a_spec()
    _seen, wraps = asked_with(
        json.dumps(
            {
                "schema_version": "agent.patch/v1",
                "base_revision": spec.revision,
                "operations": [{"op": "remove_resource", "resource_id": "article-api"}],
            }
        )
    )

    result = wraps(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"


def test_an_operation_outside_the_table_is_refused():
    spec = a_spec()
    _seen, wraps = asked_with(
        json.dumps(
            {
                "schema_version": "agent.patch/v1",
                "base_revision": spec.revision,
                "operations": [
                    {
                        "op": "add_node",
                        "node": {
                            "id": "writer",
                            "type": "llm.agent",
                            "position": {"x": 0, "y": 0},
                            "config": {},
                        },
                    }
                ],
            }
        )
    )

    result = wraps(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"


def test_an_answer_that_is_not_a_patch_is_refused_without_repeating_it():
    raw = "here is your API, sk-never-return-this"
    _seen, wraps = asked_with(raw)

    result = wraps(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"
    assert raw not in result.message


def test_a_provider_that_could_not_answer_is_carried_through():
    def model(_ask: ModelAsk) -> ModelBalked:
        return ModelBalked(reason="provider_error", message="nobody answered")

    result = tool_wrapper_from(model)(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "provider_error"
