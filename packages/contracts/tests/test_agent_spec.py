import pytest
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Edge,
    EdgeKind,
    ExecutionConfig,
    Node,
    ResourceBinding,
)
from agentcanvas_contracts.revision import compute_revision
from pydantic import ValidationError

MINIMAL_SPEC = {
    "schema_version": "agent.spec/v1",
    "id": "clinical-assistant",
    "version": 3,
    "revision": "sha256:" + "0" * 64,
    "status": "draft",
    "input_schema": {"type": "object", "properties": {"question": {"type": "string"}}},
    "state_schema": {"type": "object", "properties": {"answer": {"type": "string"}}},
    "nodes": [
        {
            "id": "input",
            "type": "core.input",
            "position": {"x": 80, "y": 240},
            "config": {"bindings": {"question": "input.question"}},
        },
        {
            "id": "output",
            "type": "core.output",
            "position": {"x": 400, "y": 240},
            "config": {"binding": "state.answer"},
        },
    ],
    "edges": [
        {
            "id": "input-output",
            "kind": "data",
            "source": {"node": "input", "port": "question"},
            "target": {"node": "output", "port": "input"},
        }
    ],
}


def spec_dict(**overrides):
    return {**MINIMAL_SPEC, **overrides}


def test_minimal_spec_loads():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    assert spec.id == "clinical-assistant"
    assert spec.status is AgentStatus.DRAFT
    assert [node.id for node in spec.nodes] == ["input", "output"]


def test_resources_and_execution_are_optional():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    assert spec.resources == []
    assert spec.execution is None


def test_missing_required_field_names_the_field():
    payload = spec_dict()
    del payload["state_schema"]
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(payload)
    error = exc.value.errors()[0]
    assert error["loc"] == ("state_schema",)
    assert error["type"] == "missing"


def test_unknown_status_value_is_rejected_with_field_location():
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(spec_dict(status="retired"))
    assert exc.value.errors()[0]["loc"] == ("status",)


def test_schema_version_is_pinned_to_v1():
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(spec_dict(schema_version="agent.spec/v2"))
    assert exc.value.errors()[0]["loc"] == ("schema_version",)


def test_revision_must_be_sha256_digest():
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(spec_dict(revision="sha256:example"))
    assert exc.value.errors()[0]["loc"] == ("revision",)


def test_unknown_top_level_field_is_rejected():
    with pytest.raises(ValidationError) as exc:
        AgentSpec.model_validate(spec_dict(owner="me"))
    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_status_lifecycle_values():
    assert [status.value for status in AgentStatus] == [
        "draft",
        "validated",
        "approved",
        "published",
        "deprecated",
    ]


def test_edge_kind_values():
    assert [kind.value for kind in EdgeKind] == ["data", "control", "approval"]


def test_edge_condition_is_kept_as_cel_string():
    edge = Edge.model_validate(
        {
            "id": "triage-agent",
            "kind": "control",
            "source": {"node": "triage", "port": "passthrough"},
            "target": {"node": "agent", "port": "messages"},
            "condition": {"language": "cel", "expression": "route == 'clinical'"},
        }
    )
    assert edge.condition.language == "cel"
    assert edge.condition.expression == "route == 'clinical'"


def test_edge_condition_language_other_than_cel_is_rejected():
    with pytest.raises(ValidationError):
        Edge.model_validate(
            {
                "id": "e",
                "kind": "control",
                "source": {"node": "a", "port": "out"},
                "target": {"node": "b", "port": "in"},
                "condition": {"language": "python", "expression": "True"},
            }
        )


def test_node_config_defaults_to_empty_dict():
    node = Node.model_validate(
        {"id": "n", "type": "core.output", "position": {"x": 0, "y": 0}}
    )
    assert node.config == {}


def test_node_config_rejects_raw_secret_value():
    with pytest.raises(ValidationError) as exc:
        Node.model_validate(
            {
                "id": "n",
                "type": "llm.agent",
                "position": {"x": 0, "y": 0},
                "config": {"api_key": "sk-live-1234567890"},
            }
        )
    assert "secret://" in str(exc.value)


def test_node_config_accepts_secret_reference():
    node = Node.model_validate(
        {
            "id": "n",
            "type": "llm.agent",
            "position": {"x": 0, "y": 0},
            "config": {"api_key": "secret://openai-api-key"},
        }
    )
    assert node.config["api_key"] == "secret://openai-api-key"


def test_execution_config_carries_limits():
    execution = ExecutionConfig.model_validate(
        {
            "checkpointer": "postgres",
            "replay_policy": "recorded_tools_first",
            "limits": {
                "max_total_tokens": 20000,
                "max_runtime_ms": 120000,
                "max_tool_calls": 12,
            },
        }
    )
    assert execution.limits.max_total_tokens == 20000


def test_execution_limits_reject_non_positive_values():
    with pytest.raises(ValidationError):
        ExecutionConfig.model_validate(
            {
                "checkpointer": "memory",
                "replay_policy": "live",
                "limits": {
                    "max_total_tokens": 0,
                    "max_runtime_ms": 1,
                    "max_tool_calls": 1,
                },
            }
        )


def test_resource_binding_requires_mcp_server_ref():
    binding = ResourceBinding.model_validate(
        {
            "id": "clinical-reference",
            "kind": "mcp.toolset",
            "server_ref": "mcp://clinical-reference",
            "allowed_tools": ["search_article"],
            "approval_policy": "read_only_auto",
        }
    )
    assert binding.server_ref == "mcp://clinical-reference"

    with pytest.raises(ValidationError) as exc:
        ResourceBinding.model_validate(
            {
                "id": "x",
                "kind": "mcp.toolset",
                "server_ref": "https://example.com",
                "allowed_tools": [],
                "approval_policy": "read_only_auto",
            }
        )
    assert exc.value.errors()[0]["loc"] == ("server_ref",)


def binding_dict(**overrides):
    return {
        "id": "clinical-reference",
        "kind": "http.api",
        "server_ref": "api://clinical-ref",
        "allowed_tools": [],
        "approval_policy": "read_only_auto",
        **overrides,
    }


@pytest.mark.parametrize(
    "server_ref", ["api://clinical-ref", "api://clinical-ref@2", "mcp://clinical-ref"]
)
def test_resource_binding_accepts_both_tool_server_schemes(server_ref):
    assert (
        ResourceBinding.model_validate(binding_dict(server_ref=server_ref)).server_ref
        == server_ref
    )


def test_resource_binding_rejects_a_plain_http_url_as_server_ref():
    with pytest.raises(ValidationError) as exc:
        ResourceBinding.model_validate(binding_dict(server_ref="http://clinical-ref"))
    assert exc.value.errors()[0]["loc"] == ("server_ref",)
    assert "must look like mcp://name[@revision] or api://name[@revision]" in str(
        exc.value
    )


def test_json_round_trip_is_stable():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    dumped = spec.model_dump(mode="json")
    assert AgentSpec.model_validate(dumped).model_dump(mode="json") == dumped


def test_round_trip_preserves_original_payload():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    assert spec.model_dump(mode="json", exclude_defaults=True) == MINIMAL_SPEC


def test_computed_revision_matches_revision_rule():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    assert spec.computed_revision() == compute_revision(spec.model_dump(mode="json"))


def test_computed_revision_ignores_stored_revision():
    spec = AgentSpec.model_validate(MINIMAL_SPEC)
    other = AgentSpec.model_validate(spec_dict(revision="sha256:" + "1" * 64))
    assert spec.computed_revision() == other.computed_revision()


def test_name_is_optional_and_absent_by_default():
    """사람이 부르는 이름 — 없이도 그래프는 성립한다."""
    assert AgentSpec.model_validate(MINIMAL_SPEC).name is None


def test_name_is_kept_as_written():
    spec = AgentSpec.model_validate(spec_dict(name="임상 도우미"))
    assert spec.name == "임상 도우미"


def test_renaming_makes_a_different_revision():
    """이름도 내용이다 — 이름만 바꿔도 다른 판이 된다."""
    plain = AgentSpec.model_validate(MINIMAL_SPEC)
    named = AgentSpec.model_validate(spec_dict(name="임상 도우미"))
    assert named.computed_revision() != plain.computed_revision()


SKILL = {
    "ref": "skill://plain-answer@1",
    "name": "plain-answer",
    "description": "Use when the answer must be easy for anyone to read.",
    "body": "Write short sentences.",
}


def test_a_document_without_skills_wears_none():
    """옛 문서는 그대로 읽힌다 — skills를 적지 않은 문서도 계약을 지킨다."""
    assert AgentSpec.model_validate(MINIMAL_SPEC).skills == []


def test_a_document_keeps_the_skills_it_holds():
    spec = AgentSpec.model_validate(spec_dict(skills=[SKILL]))
    assert [skill.name for skill in spec.skills] == ["plain-answer"]


def test_an_empty_skills_list_does_not_change_a_stored_revision():
    """빈 skills는 없는 것과 같다 — 필드가 생겼다고 옛 문서의 판이 바뀌지 않는다."""
    without = AgentSpec.model_validate(MINIMAL_SPEC)
    assert without.computed_revision() == compute_revision(
        {
            key: value
            for key, value in without.model_dump(mode="json").items()
            if key != "skills"
        }
    )


def test_wearing_one_skill_makes_it_a_different_document():
    without = AgentSpec.model_validate(MINIMAL_SPEC)
    with_one = AgentSpec.model_validate(spec_dict(skills=[SKILL]))
    assert without.computed_revision() != with_one.computed_revision()
