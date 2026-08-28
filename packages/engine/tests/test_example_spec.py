import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.revision import compute_revision
from agentcanvas_engine.validator import Severity, validate_graph

EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "examples"
EXAMPLE_PATH = EXAMPLES_DIR / "basic-agent/agent_spec.json"


def example_specs() -> list[Path]:
    """examples/ 안의 AgentSpec 파일 전부 — 케이스 파일·이벤트 기록은 스스로 밝히지 않으므로 빠진다."""
    return sorted(
        path
        for path in EXAMPLES_DIR.rglob("*.json")
        if isinstance(raw := json.loads(path.read_text(encoding="utf-8")), dict)
        and raw.get("schema_version") == "agent.spec/v1"
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


def test_the_examples_cover_more_than_one_spec():
    assert len(example_specs()) > 1


@pytest.mark.parametrize(
    "path", example_specs(), ids=lambda path: path.parent.name + "/" + path.name
)
def test_every_example_spec_is_free_of_errors(path: Path):
    """예제는 사람이 따라 만드는 본보기다 — 노드 설정까지 검증을 통과해야 한다 (경고는 허용)."""
    spec = AgentSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert [
        issue for issue in validate_graph(spec) if issue.severity is Severity.ERROR
    ] == []


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
