from __future__ import annotations

import json

import pytest
from agentcanvas_adapters.anthropic_model import asks_anthropic
from agentcanvas_adapters.architect import (
    ArchitectBalked,
    ArchitectRequest,
    ArchitectSaid,
    architect_from,
)
from agentcanvas_adapters.openai_model import OPENAI_API_KEY_REF, openai_from
from agentcanvas_adapters.scripted import (
    ScriptedChoice,
    ScriptedLLM,
    ScriptedOpenAI,
    ScriptedReply,
)
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Node,
    Position,
    ResourceBinding,
)
from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

OPENAI_KEY = "sk-test-openai-key"
LOCAL_URL = "http://127.0.0.1:11434/v1"


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


def a_request() -> ArchitectRequest:
    return ArchitectRequest(
        base_spec=a_spec(),
        request="add a writer node",
        model_ref="model://architect",
    )


def answer_for(base: AgentSpec | None = None) -> str:
    spec = base or a_spec()
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": spec.revision,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "writer",
                        "type": "llm.agent",
                        "position": {"x": 160, "y": 0},
                        "config": {},
                    },
                }
            ],
        }
    )


def ask_for(asked: ArchitectRequest) -> ModelAsk:
    """모델에게 실제로 간 물음 한 벌을 꺼낸다."""
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=answer_for(asked.base_spec),
            prompt="prompt",
        )

    architect_from(model)(asked)
    return seen[0]


def prompt_for(asked: ArchitectRequest) -> str:
    """모델이 실제로 읽는 지시문 한 벌을 꺼낸다."""
    return ask_for(asked).instruction


def json_block_after(prompt: str, label: str) -> dict | list:
    """라벨 바로 다음 줄에 놓인 JSON 한 덩어리를 읽는다."""
    lines = prompt.splitlines()
    return json.loads(lines[lines.index(label) + 1])


NODE_TYPE_LABEL = "Node types you may use (JSON):"
BASE_PORT_LABEL = "Ports of the nodes already in the base spec (JSON):"


def test_the_prompt_names_every_node_type_the_registry_knows():
    catalog = json_block_after(prompt_for(a_request()), NODE_TYPE_LABEL)

    assert {entry["type"] for entry in catalog} == set(DEFAULT_NODE_TYPES)


def test_each_listed_node_type_carries_its_ports_and_a_plain_description():
    catalog = json_block_after(prompt_for(a_request()), NODE_TYPE_LABEL)

    agent = next(entry for entry in catalog if entry["type"] == "llm.agent")
    assert agent["inputs"] == [{"id": "messages", "value": "any"}]
    assert agent["outputs"] == [
        {"id": "response", "value": "string"},
        {"id": "tool_calls", "value": "array"},
    ]
    assert agent["what_it_does"] == DEFAULT_NODE_TYPES["llm.agent"].plain_description.en


def test_a_port_that_takes_any_value_is_listed_as_any():
    catalog = json_block_after(prompt_for(a_request()), NODE_TYPE_LABEL)

    router = next(entry for entry in catalog if entry["type"] == "llm.router")
    assert router["inputs"] == [{"id": "input", "value": "any"}]
    assert {"id": "passthrough", "value": "any"} in router["outputs"]


def test_the_prompt_resolves_the_ports_of_the_nodes_already_in_the_base_spec():
    spec = a_spec()
    spec = spec.model_copy(
        update={
            "nodes": [
                *spec.nodes,
                Node(
                    id="core-output",
                    type="core.output",
                    position=Position(x=320, y=0),
                    config={"binding": "state.answer"},
                ),
            ]
        }
    )
    asked = ArchitectRequest(
        base_spec=spec.model_copy(update={"revision": spec.computed_revision()}),
        request="connect the answer",
        model_ref="model://architect",
    )

    ports = json_block_after(prompt_for(asked), BASE_PORT_LABEL)

    assert ports["input"]["outputs"] == [{"id": "question", "value": "any"}]
    assert ports["core-output"]["inputs"] == [{"id": "input", "value": "any"}]


def test_a_bound_input_port_carries_the_value_type_of_the_input_schema():
    spec = a_spec()
    spec = spec.model_copy(
        update={
            "input_schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
            }
        }
    )
    asked = ArchitectRequest(
        base_spec=spec.model_copy(update={"revision": spec.computed_revision()}),
        request="answer the question",
        model_ref="model://architect",
    )

    ports = json_block_after(prompt_for(asked), BASE_PORT_LABEL)

    assert ports["input"]["outputs"] == [{"id": "question", "value": "string"}]


def a_binding_carrying_lookup() -> ResourceBinding:
    return ResourceBinding.model_validate(
        {
            "id": "reference",
            "kind": "mcp.toolset",
            "server_ref": "mcp://reference",
            "approval_policy": "read_only_auto",
            "tools": [
                {
                    "name": "lookup",
                    "plain_description": {"ko": "찾아본다.", "en": "Looks it up."},
                    "input_schema": {"type": "object"},
                    "output_schema": {"type": "string"},
                    "timeout_ms": 5000,
                    "call": {"transport": "mcp", "remote_name": "lookup"},
                }
            ],
        }
    )


def test_a_tool_port_carries_the_value_type_of_the_tool_it_runs():
    spec = a_spec()
    spec = spec.model_copy(
        update={
            "resources": [a_binding_carrying_lookup()],
            "nodes": [
                *spec.nodes,
                Node(
                    id="tool",
                    type="tool.mcp",
                    position=Position(x=320, y=0),
                    config={"resource_ref": "reference", "tool_name": "lookup"},
                ),
            ],
        }
    )
    asked = ArchitectRequest(
        base_spec=spec.model_copy(update={"revision": spec.computed_revision()}),
        request="look the article up",
        model_ref="model://architect",
    )

    ports = json_block_after(prompt_for(asked), BASE_PORT_LABEL)

    assert {"id": "result", "value": "string"} in ports["tool"]["outputs"]


def test_the_prompt_forbids_inventing_types_and_ports():
    assert "do not invent" in prompt_for(a_request()).lower()


def test_the_prompt_says_connected_ports_must_agree_on_the_value_type():
    prompt = prompt_for(a_request()).lower()

    assert "same value type" in prompt
    assert '"any" fits every type' in prompt


def test_the_ask_carries_the_version_of_the_prompt_this_adapter_sends():
    """지시문 본문이 바뀌면 이름표의 판(@n)도 오른다 — 증거의 지문이 이 이름을 센다."""
    assert ask_for(a_request()).prompt_ref == "prompt://architect@3"


def test_the_prompt_names_the_model_the_nodes_it_adds_should_call():
    """비워 오지 않게 이름을 준다 — 다만 요구문이 다른 모델을 말하면 그쪽이 이긴다."""
    asked = a_request()
    prompt = prompt_for(asked)

    assert (
        f'Unless the request names a different model, set "model_ref" to '
        f'"{asked.model_ref}"' in prompt
    )


def a_model(ref: str, provider: str, base_url: str | None = LOCAL_URL) -> ModelDef:
    return ModelDef(
        ref=ref,
        title={"ko": "시험 모델", "en": "Test model"},
        provider=provider,
        model_id="test-model",
        base_url=base_url,
    )


def test_openai_compatible_provider_receives_the_architect_schema():
    client = ScriptedOpenAI([ScriptedChoice(answer_for())])
    model = openai_from(
        env_vault({}),
        {"model://architect": a_model("model://architect", "openai_compatible")},
        client_from=lambda _base_url, _key: client,
    )

    said = architect_from(model)(a_request())

    assert isinstance(said, ArchitectSaid)
    shape = client.requests[0]["response_format"]["json_schema"]
    assert shape["name"] == "agent_spec_patch"
    assert shape["schema"]["properties"]["operations"]["minItems"] == 1
    assert "base revision" in client.requests[0]["messages"][1]["content"]
    assert "strict" not in shape


def company_shape_for_the_architect(client: ScriptedOpenAI) -> dict:
    """본사 문으로 나간 architect 청에서 모양 한 벌을 꺼낸다."""
    model = openai_from(
        env_vault({"AGENTCANVAS_SECRET_OPENAI_API_KEY": OPENAI_KEY}),
        {"model://architect": a_model("model://architect", "openai_compatible", None)},
        client_from=lambda _base_url, key: client,
    )
    architect_from(model)(a_request())
    return client.requests[0]["response_format"]["json_schema"]


def test_openai_company_provider_is_not_asked_strictly_for_the_architect_schema():
    """엄격하게 청하면 본사는 청을 통째로 물린다 — patch 모양이 그 요구를 만족할 수 없어서다."""
    client = ScriptedOpenAI([ScriptedChoice(answer_for())])

    shape = company_shape_for_the_architect(client)

    assert "strict" not in shape
    assert OPENAI_API_KEY_REF not in str(client.requests[0])


def test_the_architect_schema_is_a_shape_strict_could_never_take():
    """엄격이 요구하는 것: 모든 열쇠가 required이고 여분을 막을 것. patch 모양은 둘 다 어긴다."""
    client = ScriptedOpenAI([ScriptedChoice(answer_for())])

    defs = company_shape_for_the_architect(client)["schema"]["$defs"]

    assert "condition" not in defs["Edge"]["required"]
    assert defs["Node"]["properties"]["config"]["additionalProperties"] is True


def test_anthropic_provider_receives_the_architect_schema():
    client = ScriptedLLM([ScriptedReply(answer_for())])
    model = asks_anthropic(
        client,
        {"model://architect": a_model("model://architect", "anthropic")},
    )

    said = architect_from(model)(a_request())

    assert isinstance(said, ArchitectSaid)
    shape = client.requests[0]["output_config"]["format"]
    assert shape["type"] == "json_schema"
    assert shape["schema"]["properties"]["operations"]["maxItems"] == 32


@pytest.mark.parametrize("text", ["not json", json.dumps({"schema_version": "wrong"})])
def test_malformed_provider_output_is_invalid_patch_without_raw_text(text: str):
    raw = "provider said sk-never-show-this"
    model = lambda _ask: ModelSaid(
        input_tokens=1, output_tokens=1, text=text or raw, prompt="prompt"
    )

    result = architect_from(model)(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"
    assert raw not in result.message


def test_provider_failure_stays_a_safe_value():
    model = lambda _ask: ModelBalked(
        reason="provider_error", message="the model could not be reached"
    )

    result = architect_from(model)(a_request())

    assert result == ArchitectBalked(
        reason="provider_error", message="the model could not be reached"
    )
