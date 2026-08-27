import json
from pathlib import Path

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.revision import compute_revision
from agentcanvas_engine.validator import validate_graph

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def load_example() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    )


def test_example_spec_loads():
    spec = load_example()
    assert spec.id == "clinical-assistant"
    assert [node.id for node in spec.nodes] == [
        "input",
        "triage",
        "clinical-agent",
        "human-gate",
        "output",
    ]


def test_example_spec_has_no_validation_issues():
    assert validate_graph(load_example()) == []


def test_example_spec_revision_matches_its_content():
    spec = load_example()
    assert spec.revision == spec.computed_revision()


def test_example_spec_round_trips():
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    assert (
        AgentSpec.model_validate(raw).model_dump(mode="json", exclude_defaults=True)
        == raw
    )


def test_stored_revision_is_the_model_path_not_the_raw_file_hash():
    """canonical 표현은 model_dump(mode="json")이다 — raw 파일 해시는 비표준 경로."""
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    spec = load_example()
    assert spec.revision == compute_revision(spec.model_dump(mode="json"))
    assert spec.revision != compute_revision(raw)
