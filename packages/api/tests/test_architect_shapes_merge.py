"""예라고 한 모양을 초안에 얹는 자리 — 얹지 못한 까닭은 언제나 말한다 (설계 문서 D11)."""

from __future__ import annotations

from agentcanvas_adapters.architect import ArchitectSaid
from agentcanvas_api.architect_service import (
    ArchitectPreview,
    blank_architect_seed,
    preview_of,
    with_shapes_said_yes,
)
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.architect_asks import PatternAnswer
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS, PatternDef

MODEL_REF = "model://openai"
ON_OFFER = list(DEFAULT_PATTERNS.values())


def a_long_chain(base: AgentSpec, forks: int) -> dict:
    """자리를 거의 다 쓴 초안 — 그림은 성립하지만 더 얹을 칸이 얼마 남지 않았다.

    사이의 단계는 갈림길(llm.router)이다: 사람 확인 템플릿이 딛는 에이전트는 하나여야
    한다(여럿이면 자리가 아니라 '어느 것에 놓을까'가 막는 까닭이 된다).
    """
    nodes = [
        {
            "op": "add_node",
            "node": {
                "id": f"fork-{index}",
                "type": "llm.router",
                "position": {"x": 200 + index * 40, "y": 0},
                "config": {"model_ref": MODEL_REF},
            },
        }
        for index in range(forks)
    ]
    nodes.append(
        {
            "op": "add_node",
            "node": {
                "id": "llm-agent",
                "type": "llm.agent",
                "position": {"x": 200 + forks * 40, "y": 0},
                "config": {"model_ref": MODEL_REF},
            },
        }
    )
    hops = [("core-input", "message", "fork-0", "input", "data")]
    hops += [
        (f"fork-{index}", "passthrough", f"fork-{index + 1}", "input", "control")
        for index in range(forks - 1)
    ]
    hops += [
        (f"fork-{forks - 1}", "passthrough", "llm-agent", "messages", "control"),
        ("llm-agent", "response", "core-output", "input", "data"),
    ]
    edges = [
        {
            "op": "add_edge",
            "edge": {
                "id": f"edge-{index}",
                "kind": kind,
                "source": {"node": source, "port": source_port},
                "target": {"node": target, "port": target_port},
            },
        }
        for index, (source, source_port, target, target_port, kind) in enumerate(hops)
    ]
    return {
        "schema_version": "agent.patch/v1",
        "base_revision": base.revision,
        "operations": [*nodes, *edges],
    }


def drafted(patch: dict) -> tuple[AgentSpec, ArchitectPreview]:
    base = blank_architect_seed("draft-merge")
    outcome = preview_of(
        base,
        ArchitectSaid(
            patch=AgentSpecPatch.model_validate(patch), input_tokens=1, output_tokens=1
        ),
        model_ref=MODEL_REF,
    )
    assert isinstance(outcome, ArchitectPreview)
    return base, outcome


def said_yes(pattern_id: str) -> list[PatternAnswer]:
    return [PatternAnswer(pattern_id=pattern_id, answer="yes")]


def test_a_shape_with_no_room_left_is_skipped_and_the_draft_survives():
    """자리(계약의 작업 상한)가 모자라도 초안은 살아 남고, 못 넣은 사실을 말한다."""
    base = blank_architect_seed("draft-merge")
    base_spec, outcome = drafted(a_long_chain(base, 14))

    merged = with_shapes_said_yes(
        outcome,
        base_spec=base_spec,
        answers=said_yes("human_gate"),
        on_offer=ON_OFFER,
        model_ref=MODEL_REF,
    )

    assert isinstance(merged, ArchitectPreview)
    assert [shape.pattern_id for shape in merged.skipped_patterns] == ["human_gate"]
    assert merged.candidate == outcome.candidate


def test_a_shape_this_server_no_longer_offers_is_said_out_loud():
    base_spec, outcome = drafted(a_long_chain(blank_architect_seed("draft-merge"), 2))

    merged = with_shapes_said_yes(
        outcome,
        base_spec=base_spec,
        answers=said_yes("human_gate"),
        on_offer=[DEFAULT_PATTERNS["react"]],
        model_ref=MODEL_REF,
    )

    assert isinstance(merged, ArchitectPreview)
    assert [shape.pattern_id for shape in merged.skipped_patterns] == ["human_gate"]


def test_a_template_that_had_nothing_to_place_is_said_out_loud():
    """조용히 아무 일도 일어나지 않는 길을 만들지 않는다 — 넣을 것이 없었으면 그렇다고 말한다."""
    base_spec, outcome = drafted(a_long_chain(blank_architect_seed("draft-merge"), 2))
    nothing_to_do = PatternDef.model_validate(
        {
            **DEFAULT_PATTERNS["human_gate"].model_dump(mode="json"),
            "id": "nothing-to-do",
            "template": [
                {"op": "remove_edge", "source": "{input}", "target": "{output}"}
            ],
        }
    )

    merged = with_shapes_said_yes(
        outcome,
        base_spec=base_spec,
        answers=said_yes("nothing-to-do"),
        on_offer=[nothing_to_do],
        model_ref=MODEL_REF,
    )

    assert isinstance(merged, ArchitectPreview)
    assert [shape.pattern_id for shape in merged.skipped_patterns] == ["nothing-to-do"]
    assert all(shape.why.ko and shape.why.en for shape in merged.skipped_patterns)


A_CONNECTION_WITH_A_TOOL = {
    "id": "records",
    "kind": "mcp",
    "server_ref": "mcp://records",
    "approval_policy": "read_only_auto",
    "tools": [
        {
            "name": "look-up",
            "plain_description": {"ko": "찾아본다.", "en": "Looks it up."},
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "timeout_ms": 5000,
            "call": {"transport": "mcp", "remote_name": "look-up"},
        }
    ],
}


def a_draft_that_acts(base: AgentSpec, *, with_a_gate: bool) -> dict:
    """도구를 쥔 에이전트가 답까지 가는 초안 — 사람 확인을 넣거나 뺀 두 벌."""
    operations: list[dict] = [
        {"op": "add_resource", "resource": A_CONNECTION_WITH_A_TOOL},
        {
            "op": "add_node",
            "node": {
                "id": "llm-agent",
                "type": "llm.agent",
                "position": {"x": 280, "y": 0},
                "config": {"model_ref": MODEL_REF, "toolset_refs": ["records"]},
            },
        },
        {
            "op": "add_edge",
            "edge": {
                "id": "edge-input-agent",
                "kind": "data",
                "source": {"node": "core-input", "port": "message"},
                "target": {"node": "llm-agent", "port": "messages"},
            },
        },
    ]
    if not with_a_gate:
        operations.append(
            {
                "op": "add_edge",
                "edge": {
                    "id": "edge-agent-output",
                    "kind": "data",
                    "source": {"node": "llm-agent", "port": "response"},
                    "target": {"node": "core-output", "port": "input"},
                },
            }
        )
    else:
        operations += [
            {
                "op": "add_node",
                "node": {
                    "id": "drawn-gate",
                    "type": "control.human_gate",
                    "position": {"x": 560, "y": 0},
                    "config": {"approval_schema_ref": "schema://answer-review@1"},
                },
            },
            {
                "op": "add_edge",
                "edge": {
                    "id": "edge-agent-gate",
                    "kind": "approval",
                    "source": {"node": "llm-agent", "port": "response"},
                    "target": {"node": "drawn-gate", "port": "review"},
                },
            },
            {
                "op": "add_edge",
                "edge": {
                    "id": "edge-gate-output",
                    "kind": "control",
                    "source": {"node": "drawn-gate", "port": "approved"},
                    "target": {"node": "core-output", "port": "input"},
                },
            },
        ]
    return {
        "schema_version": "agent.patch/v1",
        "base_revision": base.revision,
        "operations": operations,
    }


def merged_with(patch: dict, pattern_id: str) -> ArchitectPreview:
    base_spec, outcome = drafted(patch)
    merged = with_shapes_said_yes(
        outcome,
        base_spec=base_spec,
        answers=said_yes(pattern_id),
        on_offer=ON_OFFER,
        model_ref=MODEL_REF,
    )
    assert isinstance(merged, ArchitectPreview)
    return merged


def gates_in(preview: ArchitectPreview) -> int:
    return [node.type for node in preview.candidate.nodes].count("control.human_gate")


def test_a_shape_the_draft_already_has_is_not_placed_twice():
    """예라고 한 답을 조용히 버리지도, 같은 모양을 두 번 놓지도 않는다."""
    base = blank_architect_seed("draft-merge")
    merged = merged_with(a_draft_that_acts(base, with_a_gate=True), "human_gate")

    assert gates_in(merged) == 1
    assert [shape.pattern_id for shape in merged.skipped_patterns] == ["human_gate"]
    assert merged.skipped_patterns[0].why.ko == "이 초안에는 이미 그 모양이 들어 있어요"
    assert merged.skipped_patterns[0].why.en == "The draft already has this shape"


def test_a_shape_the_draft_lacks_is_still_placed():
    base = blank_architect_seed("draft-merge")
    merged = merged_with(a_draft_that_acts(base, with_a_gate=False), "human_gate")

    assert gates_in(merged) == 1
    assert merged.skipped_patterns == ()


def test_a_draft_with_nothing_to_guard_yet_still_gets_the_shape_it_asked_for():
    """규칙이 조용한 데는 '이미 있다' 말고 '아직 그럴 처지가 아니다'도 있다 (실측).

    도구가 하나도 없는 초안에서는 '사람 없이 움직인다'는 규칙이 아무 말도 하지 않는다 —
    그렇다고 사람이 청한 사람 확인을 "이미 있어요"라며 흘리지 않는다.
    """
    base = blank_architect_seed("draft-merge")
    merged = merged_with(a_long_chain(base, 1), "human_gate")

    assert gates_in(merged) == 1
    assert merged.skipped_patterns == ()
