import pytest
from agentcanvas_contracts.agent_spec import Node
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    NodeType,
    PortSpec,
    config_issues,
    resolve_ports,
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


@pytest.mark.parametrize(
    ("node_type", "field_name"),
    [("tool.mcp", "resource_ref"), ("llm.agent", "toolset_refs")],
)
def test_binding_reference_labels_use_the_same_word_as_their_description(
    node_type, field_name
):
    """라벨과 설명이 다른 말을 쓰면 사용자는 다른 것을 적는다 — 둘 다 '연결'이다."""
    field = DEFAULT_NODE_TYPES[node_type].config_schema["properties"][field_name]
    assert "Connection" in field["title"]
    assert "연결" in field["x-i18n"]["ko"]["title"]


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
