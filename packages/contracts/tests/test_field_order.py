"""필드 순서 계약 — 화면이 설정 항목을 그리는 차례는 registry가 정한다.

`x-field-order`는 config_schema(object)의 확장 키(x-i18n 선례)다. 값은 property 이름의
배열이고, 화면은 그 차례로만 그린다. 여기 테스트는 선언한 곳을 손으로 적지 않고
계약 전체를 순회한다 — 필드를 더하고 순서 선언을 안 고치면 red로 잡힌다.
"""

import pytest
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_contracts.schema_catalog import DEFAULT_SCHEMA_CATALOG

FIELD_ORDER = "x-field-order"


def object_schemas() -> dict[str, dict]:
    """계약이 화면에 그리라고 내놓는 object schema 전부 — 이름으로 찾아 온다."""
    schemas = {
        f"node type {key}": entry.config_schema
        for key, entry in DEFAULT_NODE_TYPES.items()
    }
    schemas.update(
        {
            f"schema {key}": entry.schema_
            for key, entry in DEFAULT_SCHEMA_CATALOG.items()
        }
    )
    return {
        name: schema
        for name, schema in schemas.items()
        if schema.get("type") == "object" and isinstance(schema.get("properties"), dict)
    }


def order_problems(schema: dict) -> list[str]:
    """순서 선언이 properties와 어긋난 점들 — 선언이 없으면 따질 것도 없다."""
    order = schema.get(FIELD_ORDER)
    if order is None:
        return []
    problems = []
    if len(set(order)) != len(order):
        problems.append("the same field is listed twice")
    properties = set(schema["properties"])
    for name in sorted(properties - set(order)):
        problems.append(f"{name} has no place in the order")
    for name in sorted(set(order) - properties):
        problems.append(f"{name} is ordered but is not a field")
    return problems


@pytest.mark.parametrize(
    "node_type, expected",
    [
        (
            "llm.agent",
            [
                "instruction",
                "model_ref",
                "max_turns",
                "toolset_refs",
                "skill_refs",
                "prompt_ref",
            ],
        ),
        ("llm.router", ["instruction", "model_ref", "output_schema_ref", "prompt_ref"]),
    ],
)
def test_llm_nodes_say_in_what_order_their_settings_are_drawn(node_type, expected):
    """지시문(주 필드) → 모델(유일한 필수) → 나머지 → 고급 이름표는 맨 뒤."""
    assert DEFAULT_NODE_TYPES[node_type].config_schema[FIELD_ORDER] == expected


@pytest.mark.parametrize("name", sorted(object_schemas()))
def test_every_declared_order_covers_exactly_its_own_fields(name):
    assert order_problems(object_schemas()[name]) == []


@pytest.mark.parametrize(
    "broken",
    [
        {"properties": {"a": {}, "b": {}}, FIELD_ORDER: ["a"]},
        {"properties": {"a": {}}, FIELD_ORDER: ["a", "gone"]},
        {"properties": {"a": {}, "b": {}}, FIELD_ORDER: ["a", "b", "b"]},
    ],
)
def test_the_guard_itself_notices_an_order_that_lost_or_invented_a_field(broken):
    """가드의 자기 시험 — 빠진·남는·겹친 이름을 못 잡는 가드는 가드가 아니다."""
    assert order_problems(broken) != []
