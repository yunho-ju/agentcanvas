import json
from pathlib import Path

import jsonschema
import pytest
from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG
from agentcanvas_contracts.instruction_catalog import DEFAULT_INSTRUCTION_CATALOG
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_contracts.schema_catalog import DEFAULT_SCHEMA_CATALOG
from agentcanvas_contracts.schema_export import (
    EVALUATOR_CATALOG_NAME,
    INSTRUCTION_CATALOG_NAME,
    JSON_SCHEMA_DIR,
    MODEL_CATALOG_NAME,
    NODE_REGISTRY_NAME,
    SCHEMA_CATALOG_NAME,
    SCHEMA_MODELS,
    render_evaluator_catalog,
    render_instruction_catalog,
    render_model_catalog,
    render_schema,
    render_schema_catalog,
    write_evaluator_catalog,
    write_instruction_catalog,
    write_model_catalog,
    write_schema_catalog,
    write_schemas,
)


def test_schema_models_cover_the_published_contracts():
    assert sorted(SCHEMA_MODELS) == [
        "agent_spec",
        "agent_spec_patch",
        "approval_answer",
        "eval_batch",
        "eval_case",
        "eval_dataset",
        "evaluator_def",
        "instruction_preset_def",
        "model_def",
        "node_type",
        "release_manifest",
        "run",
        "run_event",
        "schema_def",
    ]


@pytest.mark.parametrize("name", sorted(SCHEMA_MODELS))
def test_committed_schema_file_matches_the_model(name):
    path = JSON_SCHEMA_DIR / f"{name}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_schema(SCHEMA_MODELS[name])


def test_no_stale_schema_files_are_committed():
    committed = {path.stem for path in JSON_SCHEMA_DIR.glob("*.json")}
    assert committed == set(SCHEMA_MODELS) | {
        EVALUATOR_CATALOG_NAME,
        INSTRUCTION_CATALOG_NAME,
        MODEL_CATALOG_NAME,
        NODE_REGISTRY_NAME,
        SCHEMA_CATALOG_NAME,
    }


def test_committed_evaluator_catalog_matches_the_default_catalog():
    path = JSON_SCHEMA_DIR / f"{EVALUATOR_CATALOG_NAME}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_evaluator_catalog()


def test_committed_evaluator_catalog_holds_every_evaluator_keyed_by_name():
    committed = json.loads(
        (JSON_SCHEMA_DIR / f"{EVALUATOR_CATALOG_NAME}.json").read_text(encoding="utf-8")
    )
    assert sorted(committed) == sorted(DEFAULT_EVALUATOR_CATALOG)
    assert all(entry["name"] == name for name, entry in committed.items())


@pytest.mark.parametrize("name", sorted(DEFAULT_EVALUATOR_CATALOG))
def test_evaluator_validates_against_the_committed_schema(name):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "evaluator_def.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        instance=DEFAULT_EVALUATOR_CATALOG[name].model_dump(mode="json"),
        schema=schema,
    )


def test_write_evaluator_catalog_reports_the_file_it_wrote(tmp_path):
    written = write_evaluator_catalog(tmp_path)
    assert written == tmp_path / f"{EVALUATOR_CATALOG_NAME}.json"
    assert written.read_text(encoding="utf-8") == render_evaluator_catalog()


def test_committed_instruction_catalog_matches_the_default_catalog():
    path = JSON_SCHEMA_DIR / f"{INSTRUCTION_CATALOG_NAME}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_instruction_catalog()


def test_committed_instruction_catalog_holds_every_preset_keyed_by_id():
    committed = json.loads(
        (JSON_SCHEMA_DIR / f"{INSTRUCTION_CATALOG_NAME}.json").read_text(
            encoding="utf-8"
        )
    )
    assert sorted(committed) == sorted(DEFAULT_INSTRUCTION_CATALOG)
    assert all(entry["id"] == preset_id for preset_id, entry in committed.items())


@pytest.mark.parametrize("preset_id", sorted(DEFAULT_INSTRUCTION_CATALOG))
def test_instruction_preset_validates_against_the_committed_schema(preset_id):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "instruction_preset_def.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        instance=DEFAULT_INSTRUCTION_CATALOG[preset_id].model_dump(mode="json"),
        schema=schema,
    )


def test_write_instruction_catalog_reports_the_file_it_wrote(tmp_path):
    written = write_instruction_catalog(tmp_path)
    assert written == tmp_path / f"{INSTRUCTION_CATALOG_NAME}.json"
    assert written.read_text(encoding="utf-8") == render_instruction_catalog()


def test_committed_model_catalog_matches_the_default_catalog():
    path = JSON_SCHEMA_DIR / f"{MODEL_CATALOG_NAME}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_model_catalog()


def test_committed_model_catalog_holds_every_definition_keyed_by_ref():
    committed = json.loads(
        (JSON_SCHEMA_DIR / f"{MODEL_CATALOG_NAME}.json").read_text(encoding="utf-8")
    )
    assert sorted(committed) == sorted(DEFAULT_MODEL_CATALOG)
    assert all(entry["ref"] == ref for ref, entry in committed.items())


@pytest.mark.parametrize("ref", sorted(DEFAULT_MODEL_CATALOG))
def test_model_catalog_entry_validates_against_the_committed_schema(ref):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "model_def.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        instance=DEFAULT_MODEL_CATALOG[ref].model_dump(mode="json"), schema=schema
    )


def test_write_model_catalog_reports_the_file_it_wrote(tmp_path):
    written = write_model_catalog(tmp_path)
    assert written == tmp_path / f"{MODEL_CATALOG_NAME}.json"
    assert written.read_text(encoding="utf-8") == render_model_catalog()


def test_committed_schema_catalog_matches_the_default_catalog():
    path = JSON_SCHEMA_DIR / f"{SCHEMA_CATALOG_NAME}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_schema_catalog()


def test_committed_schema_catalog_holds_every_definition_keyed_by_ref():
    committed = json.loads(
        (JSON_SCHEMA_DIR / f"{SCHEMA_CATALOG_NAME}.json").read_text(encoding="utf-8")
    )
    assert sorted(committed) == sorted(DEFAULT_SCHEMA_CATALOG)
    assert all(entry["ref"] == ref for ref, entry in committed.items())


def test_committed_schema_catalog_uses_the_schema_alias_not_the_python_field_name():
    committed = json.loads(
        (JSON_SCHEMA_DIR / f"{SCHEMA_CATALOG_NAME}.json").read_text(encoding="utf-8")
    )
    assert all(
        "schema" in entry and "schema_" not in entry for entry in committed.values()
    )


@pytest.mark.parametrize("ref", sorted(DEFAULT_SCHEMA_CATALOG))
def test_schema_catalog_entry_validates_against_the_committed_schema(ref):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "schema_def.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        instance=DEFAULT_SCHEMA_CATALOG[ref].model_dump(mode="json"), schema=schema
    )


def test_write_schema_catalog_reports_the_file_it_wrote(tmp_path):
    written = write_schema_catalog(tmp_path)
    assert written == tmp_path / f"{SCHEMA_CATALOG_NAME}.json"
    assert written.read_text(encoding="utf-8") == render_schema_catalog()


def test_eval_case_schema_description_states_the_passes_needed_rule():
    """교차 필드 규칙이 validator 안에만 갇히지 않고 JSON Schema description으로 나간다."""
    schema = json.loads(
        (JSON_SCHEMA_DIR / "eval_case.json").read_text(encoding="utf-8")
    )
    assert "passes_needed" in schema["description"]
    assert "runs_per_case" in schema["description"]


def test_rendered_schema_is_valid_json_schema_document():
    document = json.loads(render_schema(SCHEMA_MODELS["agent_spec"]))
    assert document["title"] == "AgentSpec"
    assert "schema_version" in document["required"]


def test_write_schemas_reports_the_files_it_wrote(tmp_path):
    written = write_schemas(tmp_path)
    assert sorted(path.name for path in written) == [
        f"{name}.json" for name in sorted(SCHEMA_MODELS)
    ]
    assert (tmp_path / "agent_spec.json").read_text(encoding="utf-8") == render_schema(
        SCHEMA_MODELS["agent_spec"]
    )


@pytest.mark.parametrize("name", sorted(DEFAULT_NODE_TYPES))
def test_default_node_type_dump_validates_against_committed_schema(name):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "node_type.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(
        instance=DEFAULT_NODE_TYPES[name].model_dump(mode="json"), schema=schema
    )


def test_example_agent_spec_validates_against_committed_schema():
    schema = json.loads(
        (JSON_SCHEMA_DIR / "agent_spec.json").read_text(encoding="utf-8")
    )
    example = json.loads(
        (
            Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
        ).read_text(encoding="utf-8")
    )
    jsonschema.validate(instance=example, schema=schema)
