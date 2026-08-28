from __future__ import annotations

import json
from pathlib import Path

from agentcanvas_adapters.architect import ALLOWED_OPERATIONS
from agentcanvas_adapters.tool_wrapper import TOOL_WRAPPER_ALLOWED_OPERATIONS
from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.model_call import ModelBalked, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)

OPENAPI_PASTE = "openapi: 3.1.0\npaths:\n  /articles/search:\n    get: {}\n"
CURL_PASTE = "curl https://api.example.com/articles/search?query=asthma"
PROSE_PASTE = "우리 회사 문헌 검색 API는 질문을 주면 관련 글 목록을 돌려줘요."


def spec_payload() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def a_tool(auth: str = "secret://article-api-key") -> dict:
    return {
        "name": "search_articles",
        "plain_description": {"ko": "글을 검색한다.", "en": "Searches articles."},
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "title": "What to look for"}},
        },
        "output_schema": {"type": "object"},
        "timeout_ms": 8000,
        "call": {
            "transport": "http",
            "method": "GET",
            "url_template": "https://api.example.com/articles/search",
            "auth": auth,
        },
    }


def connection_answer(
    base_revision: str,
    resource_id: str = "article-search",
    tools: list[dict] | None = None,
) -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": "add_resource",
                    "resource": {
                        "id": resource_id,
                        "kind": "http.api",
                        "server_ref": "api://article-search",
                        "approval_policy": "read_only_auto",
                        "tools": [a_tool()] if tools is None else tools,
                    },
                }
            ],
        }
    )


def a_client(result: ModelSaid | ModelBalked) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            model=lambda _ask: result,
        )
    )


def wrap_body(base: dict, source_kind: str, source: str) -> dict:
    return {
        "model_ref": GUIDED_MODEL_REF,
        "source_kind": source_kind,
        "source": source,
        "base_spec": base,
    }


def wrapped(source_kind: str, source: str, answer: str | None = None):
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=2,
            output_tokens=6,
            text=answer if answer is not None else connection_answer(base["revision"]),
        )
    )
    return base, client.post("/tools/wrap", json=wrap_body(base, source_kind, source))


def test_an_api_document_becomes_a_connection_with_tools():
    base, response = wrapped("openapi", OPENAPI_PASTE)

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    added = candidate.resources[-1]
    assert added.id == "article-search"
    assert added.kind == "http.api"
    assert [tool.name for tool in added.tools] == ["search_articles"]
    assert candidate.resources[0].id == base["resources"][0]["id"]


def test_a_curl_example_becomes_a_connection_with_tools():
    _base, response = wrapped("curl", CURL_PASTE)

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    assert [tool.name for tool in candidate.resources[-1].tools] == ["search_articles"]


def test_words_of_their_own_become_a_connection_with_tools():
    _base, response = wrapped("prose", PROSE_PASTE)

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    assert [tool.name for tool in candidate.resources[-1].tools] == ["search_articles"]


def test_the_preview_does_not_save_the_document():
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1, output_tokens=1, text=connection_answer(base["revision"])
        )
    )

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 200
    assert client.get(f"/specs/{base['id']}").status_code == 404


def test_a_proposal_that_is_not_a_connection_balks_instead_of_being_fixed():
    base = spec_payload()
    broken = json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base["revision"],
            "operations": [
                {
                    "op": "add_resource",
                    "resource": {
                        "id": "article-search",
                        "kind": "http.api",
                        "server_ref": "api://article-search",
                        "approval_policy": "read_only_auto",
                        "tools": [{"name": "search_articles"}],
                    },
                }
            ],
        }
    )
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=broken))

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 502
    assert "search_articles" not in response.text


def test_a_key_written_out_in_full_is_refused():
    base = spec_payload()
    answer = connection_answer(base["revision"], tools=[a_tool(auth="sk-live-secret")])
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=answer))

    response = client.post("/tools/wrap", json=wrap_body(base, "curl", CURL_PASTE))

    assert response.status_code == 502
    assert "sk-live-secret" not in response.text


def test_a_connection_id_the_document_already_uses_is_refused():
    base = spec_payload()
    taken = base["resources"][0]["id"]
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=connection_answer(base["revision"], resource_id=taken),
        )
    )

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 422
    assert "already in the graph" in response.json()["detail"]


def test_a_proposal_that_would_pull_out_an_existing_connection_is_refused():
    """이 화면은 새로 들어올 연결만 보여 준다 — 보이지 않는 삭제를 승인하게 두지 않는다."""
    base = spec_payload()
    taken = base["resources"][0]["id"]
    removal = json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base["revision"],
            "operations": [{"op": "remove_resource", "resource_id": taken}],
        }
    )
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=removal))

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 502


def test_a_proposal_that_would_swap_an_existing_connection_is_refused():
    """짝: 통째로 갈아 끼우는 것도 지금은 없는 일이다 (재-import 화면은 P2c)."""
    base = spec_payload()
    taken = base["resources"][0]["id"]
    swap = json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base["revision"],
            "operations": [
                {
                    "op": "replace_resource",
                    "resource": {
                        "id": taken,
                        "kind": "http.api",
                        "server_ref": "api://article-search",
                        "approval_policy": "read_only_auto",
                        "tools": [a_tool()],
                    },
                }
            ],
        }
    )
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=swap))

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 502


def test_an_operation_that_would_touch_the_drawing_is_refused():
    base = spec_payload()
    graph_op = json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base["revision"],
            "operations": [{"op": "remove_edge", "edge_id": "human-output"}],
        }
    )
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=graph_op))

    response = client.post("/tools/wrap", json=wrap_body(base, "prose", PROSE_PASTE))

    assert response.status_code == 502


def test_the_wrapper_may_only_add_a_connection():
    """이 서비스가 할 수 있는 일은 연결을 더하는 것 하나뿐이다 (고치기·지우기는 P2c)."""

    assert TOOL_WRAPPER_ALLOWED_OPERATIONS == ("add_resource",)
    assert not set(TOOL_WRAPPER_ALLOWED_OPERATIONS) & set(ALLOWED_OPERATIONS)


def test_a_document_the_person_has_been_editing_is_previewed_as_it_stands():
    """화면의 문서는 아직 저장되지 않았다 — revision은 서버가 이 미리보기 안에서 맞춘다."""

    base = spec_payload()
    edited = {**base, "name": "clinic helper"}
    canonical = AgentSpec.model_validate(edited).computed_revision()
    client = a_client(
        ModelSaid(input_tokens=1, output_tokens=1, text=connection_answer(canonical))
    )

    response = client.post(
        "/tools/wrap", json=wrap_body(edited, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 200


def test_a_provider_that_is_not_configured_never_reaches_a_model():
    asked: list[object] = []

    def model(ask: object) -> ModelSaid:
        asked.append(ask)
        raise AssertionError("no model may be asked without a live provider")

    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            model=model,
        )
    )

    response = client.post(
        "/tools/wrap",
        json={
            **wrap_body(spec_payload(), "openapi", OPENAPI_PASTE),
            "model_ref": "model://default",
        },
    )

    assert response.status_code == 503
    assert asked == []


def swap_answer(base_revision: str, resource_id: str) -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": "replace_resource",
                    "resource": {
                        "id": resource_id,
                        "kind": "mcp.toolset",
                        "server_ref": "mcp://clinical-reference",
                        "allowed_tools": [],
                        "approval_policy": "read_only_auto",
                        "tools": [a_tool()],
                    },
                }
            ],
        }
    )


def reimport_body(base: dict, replacing: str) -> dict:
    return {**wrap_body(base, "openapi", OPENAPI_PASTE), "replacing": replacing}


def test_bringing_a_connection_in_again_swaps_only_that_connection():
    base = spec_payload()
    taken = base["resources"][0]["id"]
    client = a_client(
        ModelSaid(
            input_tokens=1, output_tokens=1, text=swap_answer(base["revision"], taken)
        )
    )

    response = client.post("/tools/wrap", json=reimport_body(base, taken))

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    assert [resource.id for resource in candidate.resources] == [taken]
    assert [tool.name for tool in candidate.resources[0].tools] == ["search_articles"]


def test_bringing_one_connection_in_again_may_not_reach_another():
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=swap_answer(base["revision"], "some-other-connection"),
        )
    )

    response = client.post(
        "/tools/wrap", json=reimport_body(base, base["resources"][0]["id"])
    )

    assert response.status_code == 502


def test_bringing_a_connection_in_again_may_not_add_one():
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1, output_tokens=1, text=connection_answer(base["revision"])
        )
    )

    response = client.post(
        "/tools/wrap", json=reimport_body(base, base["resources"][0]["id"])
    )

    assert response.status_code == 502


def test_a_request_without_a_target_is_still_add_only():
    """P2b 회귀 금지 — 대상 연결이 없으면 표는 그대로 더하기 하나다."""
    base = spec_payload()
    taken = base["resources"][0]["id"]
    client = a_client(
        ModelSaid(
            input_tokens=1, output_tokens=1, text=swap_answer(base["revision"], taken)
        )
    )

    response = client.post(
        "/tools/wrap", json=wrap_body(base, "openapi", OPENAPI_PASTE)
    )

    assert response.status_code == 502
