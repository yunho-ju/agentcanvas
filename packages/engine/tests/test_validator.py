import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_engine.validator import Severity, validate_graph


def build_spec(
    nodes: list[dict], edges: list[dict], resources: list[dict] | None = None
) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "test-agent",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {"type": "object"},
            "state_schema": {"type": "object"},
            "nodes": nodes,
            "edges": edges,
            "resources": resources or [],
        }
    )


def input_node(node_id: str = "input", *bindings: str) -> dict:
    return {
        "id": node_id,
        "type": "core.input",
        "position": {"x": 0, "y": 0},
        "config": {
            "bindings": {name: f"input.{name}" for name in (bindings or ("question",))}
        },
    }


def output_node(node_id: str = "output") -> dict:
    return {
        "id": node_id,
        "type": "core.output",
        "position": {"x": 100, "y": 0},
        "config": {"binding": "state.answer"},
    }


def agent_node(node_id: str = "agent", **config) -> dict:
    return {
        "id": node_id,
        "type": "llm.agent",
        "position": {"x": 50, "y": 0},
        "config": {
            "model_ref": "model://default",
            "prompt_ref": "prompt://x@1",
            **config,
        },
    }


def binding(binding_id: str) -> dict:
    return {
        "id": binding_id,
        "kind": "mcp",
        "server_ref": f"mcp://{binding_id}",
        "approval_policy": "ask",
    }


def tool_node(node_id: str = "tool", **config) -> dict:
    return {
        "id": node_id,
        "type": "tool.mcp",
        "position": {"x": 150, "y": 0},
        "config": {"tool_name": "lookup", **config},
    }


def edge(
    edge_id: str, source: tuple[str, str], target: tuple[str, str], kind: str = "data"
) -> dict:
    return {
        "id": edge_id,
        "kind": kind,
        "source": {"node": source[0], "port": source[1]},
        "target": {"node": target[0], "port": target[1]},
    }


def codes(issues, severity: Severity | None = None) -> list[str]:
    return [
        issue.code for issue in issues if severity is None or issue.severity is severity
    ]


def test_valid_graph_reports_nothing():
    spec = build_spec(
        [input_node(), output_node()],
        [edge("e1", ("input", "question"), ("output", "input"))],
    )
    assert validate_graph(spec) == []


def test_edge_pointing_at_missing_node_is_an_error():
    spec = build_spec(
        [input_node(), output_node()],
        [edge("e1", ("input", "question"), ("ghost", "input"))],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.ERROR) == ["edge.unknown_node"]
    assert issues[0].edge_id == "e1"
    assert "ghost" in issues[0].message


def test_edge_pointing_at_missing_port_is_an_error():
    spec = build_spec(
        [input_node(), output_node()],
        [edge("e1", ("input", "not_bound"), ("output", "input"))],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.ERROR) == ["edge.unknown_port"]
    assert "not_bound" in issues[0].message


def test_dynamic_input_port_from_bindings_is_accepted():
    spec = build_spec(
        [input_node("input", "patient_context"), output_node()],
        [edge("e1", ("input", "patient_context"), ("output", "input"))],
    )
    assert validate_graph(spec) == []


def test_incompatible_port_types_are_an_error():
    spec = build_spec(
        [agent_node(), agent_node("agent2")],
        [edge("e1", ("agent", "response"), ("agent2", "messages"))],
    )
    issues = validate_graph(spec)
    assert "port.schema_mismatch" in codes(issues, Severity.ERROR)
    assert any(
        "string" in issue.message and "array" in issue.message for issue in issues
    )


def test_unspecified_port_schema_is_compatible_with_anything():
    spec = build_spec(
        [input_node(), agent_node(), output_node()],
        [
            edge("e1", ("input", "question"), ("agent", "messages")),
            edge("e2", ("agent", "response"), ("output", "input")),
        ],
    )
    assert validate_graph(spec) == []


def test_unreachable_node_is_a_warning():
    spec = build_spec(
        [input_node(), output_node(), output_node("orphan")],
        [edge("e1", ("input", "question"), ("output", "input"))],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.WARNING) == ["graph.unreachable_node"]
    assert issues[0].node_id == "orphan"


def test_cycle_is_an_error():
    spec = build_spec(
        [input_node(), agent_node("a"), agent_node("b")],
        [
            edge("e1", ("input", "question"), ("a", "messages")),
            edge("e2", ("a", "tool_calls"), ("b", "messages")),
            edge("e3", ("b", "tool_calls"), ("a", "messages")),
        ],
    )
    issues = validate_graph(spec)
    assert "graph.cycle" in codes(issues, Severity.ERROR)
    cycle_issue = next(issue for issue in issues if issue.code == "graph.cycle")
    assert "a" in cycle_issue.message and "b" in cycle_issue.message


def test_control_self_loop_is_a_cycle_error():
    spec = build_spec(
        [input_node(), agent_node("a")],
        [
            edge("e1", ("input", "question"), ("a", "messages")),
            edge("e2", ("a", "tool_calls"), ("a", "messages"), kind="control"),
        ],
    )
    assert "graph.cycle" in codes(validate_graph(spec), Severity.ERROR)


def test_unknown_node_type_is_an_error():
    spec = build_spec(
        [
            input_node(),
            {"id": "weird", "type": "custom.unknown", "position": {"x": 1, "y": 1}},
        ],
        [],
    )
    issues = validate_graph(spec)
    assert "node.unknown_type" in codes(issues, Severity.ERROR)
    unknown = next(issue for issue in issues if issue.code == "node.unknown_type")
    assert unknown.node_id == "weird"
    assert "custom.unknown" in unknown.message


def test_ports_of_unknown_node_type_are_not_checked():
    spec = build_spec(
        [
            input_node(),
            {"id": "weird", "type": "custom.unknown", "position": {"x": 1, "y": 1}},
        ],
        [edge("e1", ("input", "question"), ("weird", "anything"))],
    )
    assert "edge.unknown_port" not in codes(validate_graph(spec))


def test_severity_values_are_error_and_warning():
    assert [severity.value for severity in Severity] == ["error", "warning"]


@pytest.mark.parametrize(
    "bindings",
    [5, "question", ["question"], {"": "input.question"}, {"question": 5}],
)
def test_broken_input_bindings_are_reported_instead_of_raising(bindings):
    spec = build_spec(
        [
            {
                "id": "input",
                "type": "core.input",
                "position": {"x": 0, "y": 0},
                "config": {"bindings": bindings},
            },
            output_node(),
        ],
        [],
    )
    issues = validate_graph(spec)
    assert "node.invalid_config" in codes(issues, Severity.ERROR)
    invalid = next(issue for issue in issues if issue.code == "node.invalid_config")
    assert invalid.node_id == "input"
    assert "bindings" in invalid.message


def test_missing_input_bindings_are_reported():
    spec = build_spec(
        [
            {
                "id": "input",
                "type": "core.input",
                "position": {"x": 0, "y": 0},
                "config": {},
            }
        ],
        [],
    )
    assert "node.invalid_config" in codes(validate_graph(spec), Severity.ERROR)


def test_duplicate_node_id_is_an_error_and_stops_further_checks():
    spec = build_spec([input_node(), input_node()], [])
    issues = validate_graph(spec)
    assert codes(issues) == ["node.duplicate_id"]
    assert issues[0].node_id == "input"


def test_duplicate_edge_id_is_an_error():
    spec = build_spec(
        [input_node(), output_node()],
        [
            edge("e1", ("input", "question"), ("output", "input")),
            edge("e1", ("input", "question"), ("output", "input")),
        ],
    )
    issues = validate_graph(spec)
    assert codes(issues) == ["edge.duplicate_id"]
    assert issues[0].edge_id == "e1"


def test_input_port_schema_is_taken_from_the_agent_input_schema():
    spec = AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "typed-input",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
            },
            "state_schema": {"type": "object"},
            "nodes": [input_node(), agent_node()],
            "edges": [edge("e1", ("input", "question"), ("agent", "messages"))],
        }
    )
    issues = validate_graph(spec)
    assert "port.schema_mismatch" in codes(issues, Severity.ERROR)
    assert any(
        "string" in issue.message and "array" in issue.message for issue in issues
    )


# 노드 config의 도구 참조는 spec.resources 바인딩의 id를 가리킨다 (설계: API_TOOLS_P0).
def test_tool_node_pointing_at_an_existing_binding_is_fine():
    spec = build_spec(
        [input_node(), tool_node(resource_ref="clinical-reference")],
        [edge("e1", ("input", "question"), ("tool", "input"))],
        [binding("clinical-reference")],
    )
    assert validate_graph(spec) == []


def test_tool_node_pointing_at_a_missing_binding_is_an_error():
    spec = build_spec(
        [input_node(), tool_node(resource_ref="ghost")],
        [edge("e1", ("input", "question"), ("tool", "input"))],
        [binding("clinical-reference")],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.ERROR) == ["node.unknown_binding"]
    assert issues[0].node_id == "tool"
    assert "ghost" in issues[0].message


def test_a_tool_node_with_no_reference_at_all_is_left_to_the_config_rule():
    """빈 참조는 바인딩 규칙의 몫이 아니다 — 필수 칸이 비었다고 config 규칙이 말한다.

    서버도 registry의 config_schema로 검사하므로(CONFIG_MIRROR) 화면을 거치지 않은
    그래프에서도 필수 칸이 잡힌다. 없는 이름을 가리킨다는 말은 여기서 나오지 않는다.
    """
    spec = build_spec(
        [input_node(), tool_node()],
        [edge("e1", ("input", "question"), ("tool", "input"))],
        [binding("clinical-reference")],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.ERROR) == ["node.invalid_config"]
    assert "resource_ref" in issues[0].message


def test_each_unknown_toolset_of_an_agent_is_reported_on_its_own():
    spec = build_spec(
        [
            input_node(),
            agent_node(toolset_refs=["clinical-reference", "ghost", "other-ghost"]),
        ],
        [edge("e1", ("input", "question"), ("agent", "messages"))],
        [binding("clinical-reference")],
    )
    issues = validate_graph(spec)
    assert codes(issues, Severity.ERROR) == [
        "node.unknown_binding",
        "node.unknown_binding",
    ]
    assert [issue.node_id for issue in issues] == ["agent", "agent"]
    assert "ghost" in issues[0].message and "other-ghost" in issues[1].message


@pytest.mark.parametrize("config", [{}, {"toolset_refs": []}])
def test_an_agent_that_names_no_toolset_is_fine(config):
    spec = build_spec(
        [input_node(), agent_node(**config)],
        [edge("e1", ("input", "question"), ("agent", "messages"))],
    )
    assert validate_graph(spec) == []


def test_a_graph_without_bindings_or_tool_nodes_says_nothing_about_bindings():
    spec = build_spec(
        [input_node(), output_node()],
        [edge("e1", ("input", "question"), ("output", "input"))],
    )
    assert validate_graph(spec) == []


def test_bindings_of_an_unknown_node_type_are_not_checked():
    spec = build_spec(
        [
            input_node(),
            {
                "id": "weird",
                "type": "custom.unknown",
                "position": {"x": 1, "y": 1},
                "config": {"resource_ref": "ghost"},
            },
        ],
        [],
    )
    issues = validate_graph(spec)
    assert "node.unknown_type" in codes(issues, Severity.ERROR)
    assert "node.unknown_binding" not in codes(issues)


@pytest.mark.parametrize(
    ("node", "port", "field"),
    [
        (tool_node(resource_ref=5), "input", "resource_ref"),
        (
            agent_node("tool", toolset_refs="clinical-reference"),
            "messages",
            "toolset_refs",
        ),
        (agent_node("tool", toolset_refs=[5, None]), "messages", "toolset_refs"),
    ],
)
def test_a_reference_that_is_not_text_is_left_to_the_config_rule(node, port, field):
    """바인딩 규칙은 글자만 본다 — 글자가 아닌 값은 config 규칙이 잡는다.

    같은 값을 두 규칙이 겹쳐 말하지 않는다: 없는 이름을 가리킨다는 말은 나오지 않는다.
    """
    spec = build_spec(
        [input_node(), node],
        [edge("e1", ("input", "question"), ("tool", port))],
        [binding("clinical-reference")],
    )
    issues = validate_graph(spec)
    assert set(codes(issues, Severity.ERROR)) == {"node.invalid_config"}
    assert all(field in issue.message for issue in issues)


def registry_with_tool_config_schema(config_schema: dict) -> dict:
    """tool.mcp의 config_schema만 갈아 끼운 registry — 나머지 타입은 그대로 쓴다."""
    return {
        **DEFAULT_NODE_TYPES,
        "tool.mcp": DEFAULT_NODE_TYPES["tool.mcp"].model_copy(
            update={"config_schema": config_schema}
        ),
    }


@pytest.mark.parametrize(
    "config_schema",
    [
        {"type": "object", "properties": "not an object"},
        {"type": "object", "properties": {"resource_ref": "not a schema"}},
        {"type": "object", "properties": {"resource_ref": {"items": "not a schema"}}},
        {"type": "object"},
    ],
)
def test_a_registry_that_makes_no_sense_is_judged_without_raising(config_schema):
    """registry가 망가져 있어도 검증기는 예외 대신 판정을 돌려준다."""
    spec = build_spec(
        [input_node(), tool_node(resource_ref="ghost")],
        [edge("e1", ("input", "question"), ("tool", "input"))],
        [binding("clinical-reference")],
    )
    issues = validate_graph(spec, registry_with_tool_config_schema(config_schema))
    assert "node.unknown_binding" not in codes(issues)


def test_long_chain_does_not_exhaust_the_stack():
    chain_length = 1200
    nodes = [input_node()] + [agent_node(f"a{index}") for index in range(chain_length)]
    edges = [edge("e-in", ("input", "question"), ("a0", "messages"))]
    edges += [
        edge(f"e{index}", (f"a{index}", "tool_calls"), (f"a{index + 1}", "messages"))
        for index in range(chain_length - 1)
    ]
    assert validate_graph(build_spec(nodes, edges)) == []
