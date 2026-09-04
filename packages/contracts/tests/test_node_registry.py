import pytest
from agentcanvas_contracts.agent_spec import Node, ResourceBinding
from agentcanvas_contracts.node_registry import (
    BINDING_FILTER_MARKER,
    DEFAULT_NODE_TYPES,
    ENABLED_WHEN_MARKER,
    SKILL_REF_MARKER,
    NodeType,
    PortSpec,
    binding_refs,
    config_issues,
    resolve_ports,
    skill_refs,
)
from pydantic import ValidationError

VALID_NODE_TYPE = {
    "type": "custom.echo",
    "version": "1.0",
    "runtime": "langgraph.python",
    "display_name": {"ko": "그대로 내보내기", "en": "Echo"},
    "plain_description": {
        "ko": "들어온 값을 그대로 내보낸다.",
        "en": "Sends whatever comes in straight back out.",
    },
    "ports": {
        "inputs": [{"id": "input", "schema": {"type": "string"}}],
        "outputs": [{"id": "output", "schema": {"type": "string"}}],
    },
    "config_schema": {"type": "object", "properties": {}},
}

LANGUAGES = ["ko", "en"]


def node(node_type: str, config: dict | None = None) -> Node:
    return Node.model_validate(
        {
            "id": "n",
            "type": node_type,
            "position": {"x": 0, "y": 0},
            "config": config or {},
        }
    )


def test_node_type_loads_with_ports_and_config_schema():
    node_type = NodeType.model_validate(VALID_NODE_TYPE)
    assert node_type.type == "custom.echo"
    assert [port.id for port in node_type.ports.inputs] == ["input"]
    assert node_type.config_schema["type"] == "object"


@pytest.mark.parametrize("language", LANGUAGES)
def test_node_type_rejects_a_blank_plain_description_in_either_language(language):
    text = {**VALID_NODE_TYPE["plain_description"], language: "  "}
    with pytest.raises(ValidationError) as exc:
        NodeType.model_validate({**VALID_NODE_TYPE, "plain_description": text})
    assert exc.value.errors()[0]["loc"] == ("plain_description", language)


@pytest.mark.parametrize("language", LANGUAGES)
def test_node_type_rejects_a_display_name_missing_a_language(language):
    text = {
        key: value
        for key, value in VALID_NODE_TYPE["display_name"].items()
        if key != language
    }
    with pytest.raises(ValidationError) as exc:
        NodeType.model_validate({**VALID_NODE_TYPE, "display_name": text})
    assert exc.value.errors()[0]["loc"] == ("display_name", language)


def test_node_type_rejects_a_display_name_written_in_one_language_only():
    with pytest.raises(ValidationError) as exc:
        NodeType.model_validate({**VALID_NODE_TYPE, "display_name": "Echo"})
    assert exc.value.errors()[0]["loc"] == ("display_name",)


def test_port_spec_plain_description_is_optional_but_speaks_both_languages():
    assert (
        PortSpec.model_validate({"id": "input", "schema": {}}).plain_description is None
    )
    with pytest.raises(ValidationError):
        PortSpec.model_validate(
            {
                "id": "input",
                "schema": {},
                "plain_description": {"ko": "판단할 값", "en": ""},
            }
        )


def test_default_registry_covers_the_six_base_node_types():
    assert sorted(DEFAULT_NODE_TYPES) == [
        "control.human_gate",
        "core.input",
        "core.output",
        "llm.agent",
        "llm.router",
        "tool.mcp",
    ]


@pytest.mark.parametrize("language", LANGUAGES)
def test_default_registry_entries_speak_every_language_we_publish(language):
    missing = [
        name
        for name, entry in DEFAULT_NODE_TYPES.items()
        if not getattr(entry.display_name, language).strip()
        or not getattr(entry.plain_description, language).strip()
    ]
    assert missing == []


@pytest.mark.parametrize("language", LANGUAGES)
def test_default_registry_ports_explain_themselves_in_every_language(language):
    """포트 설명은 없어도 되지만, 있다면 두 언어 모두에 있어야 한다."""
    missing = [
        f"{name}.{port.id}"
        for name, entry in DEFAULT_NODE_TYPES.items()
        for port in [*entry.ports.inputs, *entry.ports.outputs]
        if port.plain_description is not None
        and not getattr(port.plain_description, language).strip()
    ]
    assert missing == []


def test_every_config_field_explains_itself_in_plain_words():
    """inspector는 config_schema만 보고 폼을 그린다 — 라벨과 설명이 없으면 사용자가 읽을 말이 없다."""
    missing = [
        f"{name}.{field}"
        for name, entry in DEFAULT_NODE_TYPES.items()
        for field, schema in entry.config_schema.get("properties", {}).items()
        if not str(schema.get("title", "")).strip()
        or not str(schema.get("description", "")).strip()
    ]
    assert missing == []


def test_every_config_field_also_explains_itself_in_korean():
    """title/description은 JSON Schema 표준이라 영어로 두고, 한국어는 x-i18n 확장에 싣는다."""
    missing = [
        f"{name}.{field}"
        for name, entry in DEFAULT_NODE_TYPES.items()
        for field, schema in entry.config_schema.get("properties", {}).items()
        if not str(schema.get("x-i18n", {}).get("ko", {}).get("title", "")).strip()
        or not str(
            schema.get("x-i18n", {}).get("ko", {}).get("description", "")
        ).strip()
    ]
    assert missing == []


def test_config_field_titles_are_not_left_in_korean():
    """표준 소비자(다른 도구의 폼 생성기)는 x-i18n을 모른다 — title은 영어여야 한다."""
    korean = [
        f"{name}.{field}"
        for name, entry in DEFAULT_NODE_TYPES.items()
        for field, schema in entry.config_schema.get("properties", {}).items()
        if any(
            "가" <= letter <= "힣"
            for letter in f"{schema.get('title', '')}{schema.get('description', '')}"
        )
    ]
    assert korean == []


def test_human_gate_points_its_approval_form_at_the_schema_catalog():
    """ref를 손으로 적게 두지 않고 카탈로그에서 고르게 한다 — format은 컨트롤 선택 힌트다."""
    field = DEFAULT_NODE_TYPES["control.human_gate"].config_schema["properties"][
        "approval_schema_ref"
    ]
    assert field["format"] == "schema-ref"


def test_human_gate_does_not_refuse_an_approval_ref_already_saved():
    """이미 저장된 문서에는 카탈로그에 없는 이름이 들어 있을 수 있다 — 계약이 그것을 깨지 않는다."""
    field = DEFAULT_NODE_TYPES["control.human_gate"].config_schema["properties"][
        "approval_schema_ref"
    ]
    assert "pattern" not in field
    assert "enum" not in field


@pytest.mark.parametrize("node_type", ["llm.router", "llm.agent"])
def test_llm_nodes_point_their_model_field_at_the_model_catalog(node_type):
    """많이 쓰는 모델은 고르게 한다 — format은 컨트롤 선택 힌트다."""
    field = DEFAULT_NODE_TYPES[node_type].config_schema["properties"]["model_ref"]
    assert field["format"] == "model-ref"


@pytest.mark.parametrize("node_type", ["llm.router", "llm.agent"])
def test_llm_nodes_do_not_refuse_a_model_ref_already_saved(node_type):
    """이미 저장된 문서에는 카탈로그에 없는 이름이 들어 있을 수 있다 — 계약이 그것을 깨지 않는다."""
    field = DEFAULT_NODE_TYPES[node_type].config_schema["properties"]["model_ref"]
    assert "pattern" not in field
    assert "enum" not in field


def test_router_points_its_answer_shape_at_the_schema_catalog():
    field = DEFAULT_NODE_TYPES["llm.router"].config_schema["properties"][
        "output_schema_ref"
    ]
    assert field["format"] == "schema-ref"


def test_tool_node_marks_its_server_field_as_a_binding_reference():
    """도구 노드는 서버 주소가 아니라 spec.resources 바인딩의 id를 가리킨다."""
    field = DEFAULT_NODE_TYPES["tool.mcp"].config_schema["properties"]["resource_ref"]
    assert field["x-binding-ref"] is True


def test_agent_node_marks_each_toolset_entry_as_a_binding_reference():
    """묶음 목록의 원소 하나하나가 바인딩 id다 — 마커는 items에 붙는다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["toolset_refs"]
    assert field["items"]["x-binding-ref"] is True


@pytest.mark.parametrize(
    ("node_type", "field_name"),
    [("tool.mcp", "resource_ref"), ("llm.agent", "toolset_refs")],
)
def test_binding_reference_fields_say_they_want_a_binding_id(node_type, field_name):
    """규약을 설명 문장에도 적는다 — 사용자가 mcp:// 주소를 적지 않도록."""
    field = DEFAULT_NODE_TYPES[node_type].config_schema["properties"][field_name]
    assert "connection" in field["description"]
    assert "연결" in field["x-i18n"]["ko"]["description"]


def test_binding_reference_labels_use_the_same_word_as_their_description():
    """라벨과 설명이 다른 말을 쓰면 사용자는 다른 것을 적는다 — 둘 다 '연결'이다."""
    field = DEFAULT_NODE_TYPES["tool.mcp"].config_schema["properties"]["resource_ref"]
    assert "Connection" in field["title"]
    assert "연결" in field["x-i18n"]["ko"]["title"]


def test_agent_tool_field_is_called_what_it_gives_the_step():
    """사람이 고르는 것은 도구다 — 화면과 계약이 두 이름을 쓰지 않는다 (DESIGN §7)."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["toolset_refs"]
    assert field["title"] == "Tools it may use"
    assert field["x-i18n"]["ko"]["title"] == "쓸 도구"


def test_agent_tool_field_offers_only_connections_that_carry_tools():
    """고를 것을 거르는 규칙도 표식이다 — 폼은 노드 타입을 보지 않는다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["toolset_refs"]
    assert field["items"][BINDING_FILTER_MARKER] == "with_tools"


@pytest.mark.parametrize(
    "field_name", sorted(DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"])
)
def test_agent_card_speaks_in_one_voice(field_name):
    """한 카드 안의 말투는 하나다 — 이 노드의 모든 칸 설명은 해요체다 (DESIGN §7 agent-turns)."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"][field_name]
    # 예시("예: model://default")는 말투를 가진 문장이 아니다 — 그 앞까지를 본다.
    said = field["x-i18n"]["ko"]["description"].split("예:")[0]
    assert said.strip().rstrip(".").endswith("요")


def test_agent_turns_default_to_answering_in_one_go():
    """아무도 적지 않은 노드는 한 번에 답한다 — 기본값이 그 사실을 말한다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["max_turns"]
    assert field["default"] == 1


def test_agent_turns_say_what_a_turn_is_and_what_it_costs_in_both_languages():
    """마무리 호출은 이 횟수 밖이다 — 그 사실과 비용을 hover 뒤에 숨기지 않는다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["max_turns"]
    assert field["description"] == (
        "How many times it may call tools while shaping its answer — then one "
        "more call to settle it. Each turn costs a model call"
    )
    assert field["x-i18n"]["ko"]["description"] == (
        "도구를 부르며 답을 다듬는 횟수예요 — 그 뒤 한 번 더 답을 정리해요. "
        "턴마다 모델 호출 비용이 들어요"
    )


def test_agent_turns_are_only_open_while_a_tool_is_picked():
    """도구 없이 여러 턴은 뜻이 없다 — 의존을 표식으로 선언하고 폼이 읽는다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["max_turns"]
    assert field[ENABLED_WHEN_MARKER] == {
        "field": "toolset_refs",
        "when": "non_empty",
        "hint": {
            "ko": "도구를 고르면 여러 번 시도할 수 있어요",
            "en": "Pick a tool first to allow more than one turn",
        },
    }


def test_enabled_when_marker_points_at_a_field_that_exists():
    """가리키는 칸이 없으면 폼은 영영 잠긴 칸을 그린다."""
    for node_type in DEFAULT_NODE_TYPES.values():
        properties = node_type.config_schema.get("properties", {})
        for field in properties.values():
            marker = field.get(ENABLED_WHEN_MARKER)
            if marker is not None:
                assert marker["field"] in properties


def test_default_registry_keys_match_node_type_field():
    assert all(key == entry.type for key, entry in DEFAULT_NODE_TYPES.items())


@pytest.mark.parametrize("node_type", ["llm.router", "llm.agent"])
def test_llm_nodes_take_instructions_written_in_plain_words(node_type):
    """에이전트에게 할 일을 직접 적는다 — 골라 채우고 고쳐 쓰는 여러 줄 글이다."""
    schema = DEFAULT_NODE_TYPES[node_type].config_schema
    field = schema["properties"]["instruction"]
    assert field["type"] == "string"
    assert field["format"] == "instruction"


@pytest.mark.parametrize("node_type", ["llm.router", "llm.agent"])
def test_the_instruction_field_says_the_same_thing_it_always_did(node_type):
    """편집기 힌트만 바뀐다 — 이름·제목·설명·필수 여부는 그대로다."""
    field = DEFAULT_NODE_TYPES[node_type].config_schema["properties"]["instruction"]
    assert field["title"] == "Instructions"
    assert field["description"].endswith("The model reads it exactly as you wrote it.")
    assert field["x-i18n"]["ko"]["title"] == "지시문"


@pytest.mark.parametrize("node_type", ["llm.router", "llm.agent"])
def test_the_prompt_name_is_no_longer_forced_on_anyone(node_type):
    """지시문을 직접 쓰면 된다 — prompt:// 이름을 지어내라고 강요하지 않는다."""
    schema = DEFAULT_NODE_TYPES[node_type].config_schema
    assert "prompt_ref" not in schema["required"]
    assert "instruction" not in schema["required"]


def test_core_input_output_ports_come_from_config_bindings():
    resolved = resolve_ports(
        node(
            "core.input",
            {
                "bindings": {
                    "question": "input.question",
                    "patient_context": "input.patient_context",
                }
            },
        ),
        DEFAULT_NODE_TYPES["core.input"],
    )
    assert sorted(resolved.outputs) == ["patient_context", "question"]
    assert resolved.inputs == {}


def test_core_input_without_bindings_has_no_output_ports():
    resolved = resolve_ports(node("core.input"), DEFAULT_NODE_TYPES["core.input"])
    assert resolved.outputs == {}


def test_core_input_bindings_ask_for_the_input_rows_editor():
    # 화면은 노드 타입 이름으로 편집기를 고르지 않는다 — 계약이 format으로 말한다
    # (DESIGN §7 input-rows).
    bindings = DEFAULT_NODE_TYPES["core.input"].config_schema["properties"]["bindings"]
    assert bindings["format"] == "input-rows"


def test_core_output_has_single_fixed_input_port():
    resolved = resolve_ports(
        node("core.output", {"binding": "state.answer"}),
        DEFAULT_NODE_TYPES["core.output"],
    )
    assert list(resolved.inputs) == ["input"]
    assert resolved.outputs == {}


def test_other_node_types_use_static_registry_ports_only():
    resolved = resolve_ports(
        node("llm.agent", {"bindings": {"ignored": "input.x"}}),
        DEFAULT_NODE_TYPES["llm.agent"],
    )
    assert list(resolved.inputs) == ["messages"]
    assert sorted(resolved.outputs) == ["response", "tool_calls"]


def test_resolved_ports_expose_port_schema():
    resolved = resolve_ports(node("llm.agent"), DEFAULT_NODE_TYPES["llm.agent"])
    assert resolved.outputs["response"].schema_ == {"type": "string"}


def test_port_plain_description_of_only_whitespace_is_rejected():
    with pytest.raises(ValidationError):
        PortSpec.model_validate(
            {
                "id": "input",
                "schema": {},
                "plain_description": {"ko": "  ", "en": "The value to judge"},
            }
        )


def test_node_type_dump_uses_the_schema_alias():
    dumped = DEFAULT_NODE_TYPES["llm.agent"].model_dump(mode="json")
    assert "schema" in dumped["ports"]["outputs"][0]
    assert "schema_" not in dumped["ports"]["outputs"][0]


def test_node_type_dump_round_trips():
    node_type = DEFAULT_NODE_TYPES["llm.agent"]
    assert NodeType.model_validate(node_type.model_dump(mode="json")) == node_type


@pytest.mark.parametrize(
    "config",
    [
        {"bindings": 5},
        {"bindings": "question"},
        {"bindings": ["question"]},
        {"bindings": {"": "input.question"}},
        {"bindings": {"question": 5}},
        {},
    ],
)
def test_resolve_ports_never_raises_on_broken_input_bindings(config):
    resolved = resolve_ports(
        node("core.input", config), DEFAULT_NODE_TYPES["core.input"]
    )
    assert resolved.outputs == {}


@pytest.mark.parametrize(
    "config",
    [
        {"bindings": 5},
        {"bindings": "question"},
        {"bindings": ["question"]},
        {"bindings": {"": "input.question"}},
        {"bindings": {"question": 5}},
    ],
)
def test_config_issues_reports_broken_input_bindings(config):
    assert (
        config_issues(node("core.input", config), DEFAULT_NODE_TYPES["core.input"])
        != []
    )


@pytest.mark.parametrize(
    "config",
    [{}, {"bindings": "question"}, {"bindings": {"question": 5}}],
)
def test_config_issues_says_one_mistake_only_once(config):
    """한 실수를 schema 검사와 core.input 규칙이 겹쳐 말하지 않는다."""
    assert (
        len(config_issues(node("core.input", config), DEFAULT_NODE_TYPES["core.input"]))
        == 1
    )


def test_config_issues_still_catches_a_name_that_cannot_be_a_port():
    """schema가 표현하지 못하는 규칙은 core.input 쪽에 남는다 — 빈 이름은 포트가 될 수 없다."""
    issues = config_issues(
        node("core.input", {"bindings": {"  ": "input.question"}}),
        DEFAULT_NODE_TYPES["core.input"],
    )
    assert len(issues) == 1
    assert "port name" in issues[0]


def test_config_issues_is_empty_for_a_well_formed_input_node():
    valid = node("core.input", {"bindings": {"question": "input.question"}})
    assert config_issues(valid, DEFAULT_NODE_TYPES["core.input"]) == []


def test_config_issues_applies_the_bindings_rule_only_to_the_input_node():
    """core.input의 bindings 규칙은 다른 타입에 번지지 않는다 — 그쪽 schema만이 판정한다."""
    assert (
        config_issues(
            node("llm.agent", {"model_ref": "model://default", "bindings": 5}),
            DEFAULT_NODE_TYPES["llm.agent"],
        )
        == []
    )


def test_config_issues_reports_every_required_field_left_empty():
    issues = config_issues(node("tool.mcp", {}), DEFAULT_NODE_TYPES["tool.mcp"])
    assert len(issues) == 2
    assert any("resource_ref" in issue for issue in issues)
    assert any("tool_name" in issue for issue in issues)


def test_config_issues_reports_a_value_of_the_wrong_kind():
    issues = config_issues(
        node("llm.agent", {"model_ref": "model://default", "max_turns": "three"}),
        DEFAULT_NODE_TYPES["llm.agent"],
    )
    assert len(issues) == 1
    assert "max_turns" in issues[0]


def test_config_issues_reports_a_number_below_the_allowed_minimum():
    issues = config_issues(
        node("llm.agent", {"model_ref": "model://default", "max_turns": 0}),
        DEFAULT_NODE_TYPES["llm.agent"],
    )
    assert len(issues) == 1
    assert "max_turns" in issues[0]


def test_config_issues_says_nothing_about_a_config_the_schema_accepts():
    assert (
        config_issues(
            node(
                "tool.mcp", {"resource_ref": "clinical-reference", "tool_name": "get"}
            ),
            DEFAULT_NODE_TYPES["tool.mcp"],
        )
        == []
    )


def test_config_issues_accepts_anything_when_the_schema_names_no_fields():
    free_type = NodeType.model_validate(
        {**VALID_NODE_TYPE, "config_schema": {"type": "object"}}
    )
    assert config_issues(node("custom.echo", {"whatever": 1}), free_type) == []


@pytest.mark.parametrize(
    "config_schema",
    [
        {"type": "object", "properties": "not an object"},
        {"type": "object", "properties": {"whatever": "not a schema"}},
        {"type": "not-a-type"},
    ],
)
def test_config_issues_says_nothing_when_the_schema_cannot_be_read(config_schema):
    """읽을 수 없는 schema로 사용자의 편집을 막지 않는다 (studio validatorFor와 같은 규칙)."""
    broken = NodeType.model_validate(
        {**VALID_NODE_TYPE, "config_schema": config_schema}
    )
    assert config_issues(node("custom.echo", {"whatever": 1}), broken) == []


def keywords_used(schema: object) -> set[str]:
    if isinstance(schema, dict):
        return set(schema) | {
            keyword for value in schema.values() for keyword in keywords_used(value)
        }
    if isinstance(schema, list):
        return {keyword for item in schema for keyword in keywords_used(item)}
    return set()


def test_the_registry_asks_for_no_pattern():
    """`pattern`은 두 언어가 같은 답을 낸다고 말할 수 없는 규칙이다 — 쓰기 전에 결정이 필요하다.

    정규식 방언이 다르다(Python `re` vs ECMAScript). 게다가 Python이 읽지 못하는 정규식은
    `config_issues`가 검사를 통째로 생략하는 쪽으로 안전하게 물러서는데, studio ajv는 그대로
    검사한다 — 미러가 조용히 갈린다. 이 단언이 깨지면 그 갈림을 먼저 결정하라
    (예: 미러 케이스로 방언 차이를 고정하거나, pattern 대신 enum·format을 쓴다).
    """
    with_pattern = sorted(
        node_type.type
        for node_type in DEFAULT_NODE_TYPES.values()
        if "pattern" in keywords_used(node_type.config_schema)
    )
    assert with_pattern == []


def test_config_issues_says_nothing_when_a_schema_points_at_a_missing_piece():
    """$ref가 가리키는 곳이 없어도 예외 대신 검사 생략이다 (studio ajv도 같은 답을 낸다)."""
    dangling = NodeType.model_validate(
        {
            **VALID_NODE_TYPE,
            "config_schema": {
                "type": "object",
                "properties": {"whatever": {"$ref": "#/definitions/gone"}},
            },
        }
    )
    assert config_issues(node("custom.echo", {"whatever": 1}), dangling) == []


def test_input_port_schema_comes_from_the_agent_input_schema():
    resolved = resolve_ports(
        node("core.input", {"bindings": {"question": "input.question"}}),
        DEFAULT_NODE_TYPES["core.input"],
        input_schema={"type": "object", "properties": {"question": {"type": "string"}}},
    )
    assert resolved.outputs["question"].schema_ == {"type": "string"}


def test_input_port_schema_is_unspecified_when_the_property_is_missing():
    resolved = resolve_ports(
        node("core.input", {"bindings": {"question": "input.question"}}),
        DEFAULT_NODE_TYPES["core.input"],
        input_schema={"type": "object", "properties": {}},
    )
    assert resolved.outputs["question"].schema_ == {}


def test_input_port_schema_is_unspecified_without_an_input_schema():
    resolved = resolve_ports(
        node("core.input", {"bindings": {"question": "input.question"}}),
        DEFAULT_NODE_TYPES["core.input"],
    )
    assert resolved.outputs["question"].schema_ == {}


def a_binding_carrying_lookup(output_schema: dict) -> ResourceBinding:
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
                    "input_schema": {"type": "object", "properties": {}},
                    "output_schema": output_schema,
                    "timeout_ms": 5000,
                    "call": {"transport": "mcp", "remote_name": "lookup"},
                }
            ],
        }
    )


TOOL_NODE_CONFIG = {"resource_ref": "reference", "tool_name": "lookup"}


def test_a_tool_node_wears_the_tool_without_gaining_or_losing_a_port():
    """도구 마커는 있던 포트의 schema만 갈아입힌다 — 포트 이름표는 그대로다.

    포트 이름만 쓰는 자리(studio landingPorts)가 바인딩을 몰라도 안전한 이유다.
    """
    tool_type = DEFAULT_NODE_TYPES["tool.mcp"]
    static = resolve_ports(node("tool.mcp", TOOL_NODE_CONFIG), tool_type)
    dressed = resolve_ports(
        node("tool.mcp", TOOL_NODE_CONFIG),
        tool_type,
        None,
        [a_binding_carrying_lookup({"type": "string"})],
    )
    assert (set(dressed.inputs), set(dressed.outputs)) == (
        set(static.inputs),
        set(static.outputs),
    )
    assert dressed.outputs["result"].schema_ == {"type": "string"}


def a_node_type_wearing_both_markers() -> NodeType:
    """bindings로도 포트가 생기고 도구도 입는, 두 마커가 겹친 가상의 노드 타입."""
    return NodeType.model_validate(
        {
            **VALID_NODE_TYPE,
            "type": "core.input",
            "ports": {"inputs": [], "outputs": [{"id": "result", "schema": {}}]},
            "config_schema": {
                "type": "object",
                "properties": {
                    "resource_ref": {"type": "string", "x-binding-ref": True},
                    "tool_name": {"type": "string"},
                    "bindings": {"type": "object"},
                },
                "x-tool-ports": {
                    "tool_name_field": "tool_name",
                    "input_port": "input",
                    "output_port": "result",
                },
            },
        }
    )


def test_the_tool_dresses_a_port_the_bindings_already_made():
    """두 동적 해석이 같은 포트를 맡으면 도구가 나중에 입힌다 — TS 미러와 같은 차례."""
    resolved = resolve_ports(
        node(
            "core.input", {**TOOL_NODE_CONFIG, "bindings": {"result": "input.result"}}
        ),
        a_node_type_wearing_both_markers(),
        {"type": "object", "properties": {"result": {"type": "number"}}},
        [a_binding_carrying_lookup({"type": "string"})],
    )
    assert resolved.outputs["result"].schema_ == {"type": "string"}


@pytest.mark.parametrize(
    "plan",
    [
        {"tool_name_field": ["tool_name"], "output_port": "result"},
        {"tool_name_field": {"tool_name": True}, "output_port": "result"},
        {"output_port": "result"},
    ],
)
def test_a_marker_that_does_not_name_a_config_field_falls_back_quietly(plan):
    """마커가 이상하게 적혀도 예외 대신 정적 포트다 — studio와 같은 답."""
    broken = NodeType.model_validate(
        {
            **VALID_NODE_TYPE,
            "ports": {"inputs": [], "outputs": [{"id": "result", "schema": {}}]},
            "config_schema": {
                "type": "object",
                "properties": {
                    "resource_ref": {"type": "string", "x-binding-ref": True},
                    "tool_name": {"type": "string"},
                },
                "x-tool-ports": plan,
            },
        }
    )
    resolved = resolve_ports(
        node("custom.echo", TOOL_NODE_CONFIG),
        broken,
        None,
        [a_binding_carrying_lookup({"type": "string"})],
    )
    assert resolved.outputs["result"].schema_ == {}


def an_agent_wearing(refs) -> Node:
    return node("llm.agent", {"model_ref": "model://default", "skill_refs": refs})


def test_the_agent_can_be_told_which_skills_it_wears():
    """입는 skill은 registry가 만드는 칸이다 — 화면이 이름을 외우지 않는다."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["skill_refs"]
    assert field["type"] == "array"
    assert field["items"][SKILL_REF_MARKER] is True
    assert field["title"] == "Skills it wears"
    assert field["x-i18n"]["ko"]["title"] == "입는 skill"


def test_skill_refs_reads_what_the_node_wrote_in_the_marked_field():
    refs = skill_refs(
        an_agent_wearing(["skill://plain-answer@1", "skill://cite-sources@1"]),
        DEFAULT_NODE_TYPES["llm.agent"],
    )
    assert refs == ["skill://plain-answer@1", "skill://cite-sources@1"]


def test_skill_refs_skips_entries_that_are_not_names():
    refs = skill_refs(
        an_agent_wearing(["skill://plain-answer@1", 7, None]),
        DEFAULT_NODE_TYPES["llm.agent"],
    )
    assert refs == ["skill://plain-answer@1"]


def test_the_connection_reader_never_mistakes_a_worn_skill_for_a_connection():
    """표식이 갈라져 있어야 skill이 끊긴 연결로 잘못 잡히지 않는다."""
    assert (
        binding_refs(
            an_agent_wearing(["skill://plain-answer@1"]),
            DEFAULT_NODE_TYPES["llm.agent"],
        )
        == []
    )


def test_the_skill_reader_never_mistakes_a_connection_for_a_skill():
    worn = node(
        "llm.agent", {"model_ref": "model://default", "toolset_refs": ["reference"]}
    )
    assert skill_refs(worn, DEFAULT_NODE_TYPES["llm.agent"]) == []


@pytest.mark.parametrize("language", ["en", "ko"])
def test_the_skill_field_shows_the_shape_of_what_goes_in_it(language: str):
    """칸은 체크 목록이다 — 사람에게 이름표 문법이 아니라 고르는 법을 말한다 (DESIGN §7 skill-wear)."""
    field = DEFAULT_NODE_TYPES["llm.agent"].config_schema["properties"]["skill_refs"]
    description = (
        field["description"]
        if language == "en"
        else field["x-i18n"]["ko"]["description"]
    )
    assert "skill://" not in description
    assert ("Tick" in description) or ("골라요" in description)
