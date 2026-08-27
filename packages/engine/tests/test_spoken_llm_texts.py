"""spoken_llm_texts — 말하는 노드들이 낸 말을 일어난 순서 그대로 공개한다.

갈림길(router)이 답한 봉투(길 선택 JSON)는 산출이 아니므로 담지 않는다 — `_spoken_in`과
같은 규칙이다. 배치 판정처럼 "마지막으로 말한 것"이 필요한 자리가 이것을 쓴다: 노드별로
마지막 값만 남기는 내부용 `_spoken_in`과 달리, 일어난 순서를 그대로 지켜 돌려준다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Edge,
    EdgeCondition,
    EdgeEndpoint,
    EdgeKind,
    Node,
    Position,
)
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from agentcanvas_engine.routed_runtime import routed_run, spoken_llm_texts

RUN_ID = "run_spoken"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64


def a_node(node_id: str, node_type: str = "llm.agent") -> Node:
    return Node(id=node_id, type=node_type, position=Position(x=0, y=0), config={})


def an_edge(
    edge_id: str,
    source: str,
    target: str,
    *,
    source_port: str = "output",
    target_port: str = "input",
    expression: str | None = None,
) -> Edge:
    return Edge(
        id=edge_id,
        kind=EdgeKind.DATA,
        source=EdgeEndpoint(node=source, port=source_port),
        target=EdgeEndpoint(node=target, port=target_port),
        condition=(
            None
            if expression is None
            else EdgeCondition(language="cel", expression=expression)
        ),
    )


def a_spec(nodes: list[Node], edges: list[Edge], state_schema: dict) -> AgentSpec:
    return AgentSpec(
        schema_version="agent.spec/v1",
        id="spoken",
        version=1,
        revision=REVISION,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema=state_schema,
        nodes=nodes,
        edges=edges,
    )


def a_writer_a_router_and_two_outputs() -> AgentSpec:
    """리뷰가 재현한 그래프 — writer(llm.agent) → router(llm.router) → 2갈래 core.output."""
    return a_spec(
        nodes=[
            a_node("writer"),
            a_node("triage", "llm.router"),
            a_node("out-a", "core.output"),
            a_node("out-b", "core.output"),
        ],
        edges=[
            an_edge("writer-triage", "writer", "triage", target_port="draft"),
            an_edge(
                "triage-a",
                "triage",
                "out-a",
                source_port="route",
                target_port="note",
                expression="route == 'a'",
            ),
            an_edge(
                "triage-b",
                "triage",
                "out-b",
                source_port="route",
                target_port="note",
                expression="route == 'b'",
            ),
        ],
        state_schema={
            "type": "object",
            "properties": {"route": {}, "draft": {}, "note": {}},
        },
    )


def routes_after_writing(ask: ModelAsk) -> ModelSaid:
    """길을 고르는 노드는 고른 길을 봉투(JSON)에 담아 말하고, 말하는 노드는 그냥 말한다."""
    if ask.ways:
        return ModelSaid(
            input_tokens=1,
            output_tokens=1,
            way=ask.ways[0],
            text=json.dumps({"way": ask.ways[0]}),
        )
    return ModelSaid(input_tokens=1, output_tokens=1, text="hello there")


def test_a_router_envelope_is_not_counted_as_spoken_text():
    """리뷰가 재현한 그래프에서, writer의 말만 남고 router의 길 선택 봉투는 빠진다."""
    spec = a_writer_a_router_and_two_outputs()

    events = routed_run(spec, RUN_ID, STARTED_AT, model=routes_after_writing)

    assert spoken_llm_texts(spec, events) == ["hello there"]


def two_writers_in_a_row() -> AgentSpec:
    """말하는 노드 둘이 이어진 줄 — 나중에 말한 노드의 말이 끝에 와야 한다."""
    return a_spec(
        nodes=[a_node("first"), a_node("second")],
        edges=[an_edge("first-second", "first", "second", target_port="heard")],
        state_schema={"type": "object", "properties": {"heard": {}}},
    )


def test_texts_from_multiple_nodes_are_kept_in_the_order_they_were_spoken():
    """B1의 마지막 규칙 — 여러 노드가 말했으면, 나중에 말한 것이 리스트의 끝에 온다."""
    spec = two_writers_in_a_row()
    texts = iter(["first said this", "second said that"])

    def says_in_order(ask: ModelAsk) -> ModelSaid:
        return ModelSaid(input_tokens=1, output_tokens=1, text=next(texts))

    events = routed_run(spec, RUN_ID, STARTED_AT, model=says_in_order)

    assert spoken_llm_texts(spec, events) == ["first said this", "second said that"]
