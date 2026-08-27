import json

import jsonschema
import pytest
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_contracts.schema_export import (
    JSON_SCHEMA_DIR,
    NODE_REGISTRY_NAME,
    render_node_registry,
    write_node_registry,
)


def committed_registry() -> dict:
    return json.loads(
        (JSON_SCHEMA_DIR / f"{NODE_REGISTRY_NAME}.json").read_text(encoding="utf-8")
    )


def test_committed_registry_file_matches_the_default_registry():
    path = JSON_SCHEMA_DIR / f"{NODE_REGISTRY_NAME}.json"
    assert path.exists(), (
        f"{path} is missing — run python -m agentcanvas_contracts.schema_export"
    )
    assert path.read_text(encoding="utf-8") == render_node_registry()


def test_committed_registry_holds_every_default_node_type():
    assert sorted(committed_registry()) == sorted(DEFAULT_NODE_TYPES)


@pytest.mark.parametrize("name", sorted(DEFAULT_NODE_TYPES))
def test_committed_registry_entry_validates_against_the_node_type_schema(name):
    schema = json.loads(
        (JSON_SCHEMA_DIR / "node_type.json").read_text(encoding="utf-8")
    )
    jsonschema.validate(instance=committed_registry()[name], schema=schema)


def test_committed_registry_ports_use_the_schema_alias_not_the_python_field_name():
    ports = [
        port
        for entry in committed_registry().values()
        for port in entry["ports"]["inputs"] + entry["ports"]["outputs"]
    ]
    assert ports, "the registry has no ports to check"
    assert all("schema" in port and "schema_" not in port for port in ports)


def test_write_node_registry_reports_the_file_it_wrote(tmp_path):
    written = write_node_registry(tmp_path)
    assert written == tmp_path / f"{NODE_REGISTRY_NAME}.json"
    assert written.read_text(encoding="utf-8") == render_node_registry()
