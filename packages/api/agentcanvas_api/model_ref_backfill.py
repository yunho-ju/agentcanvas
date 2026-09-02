"""초안이 부를 모델을 채운다 — 그림만 그린 제안을 그대로 실행할 수 있게 하는 한 걸음."""

from __future__ import annotations

from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES

MODEL_REF_FIELD = "model_ref"


def _asks_for_a_model(node: Node) -> bool:
    """이 노드가 모델 이름을 요구하는가 — 타입 이름이 아니라 registry의 config_schema가 정한다."""
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return False
    required = node_type.config_schema.get("required")
    return isinstance(required, list) and MODEL_REF_FIELD in required


def _is_blank(value: object) -> bool:
    return not isinstance(value, str) or value.strip() == ""


def with_model_ref_filled(
    spec: AgentSpec, model_ref: str, *, only: set[str] | None = None
) -> AgentSpec:
    """모델 이름이 빈 노드에 `model_ref`를 적어 넣은 새 spec을 돌려준다 (spec in → spec out).

    제안한 모델이 스스로 고른 이름은 덮어쓰지 않는다. `only`를 건네면 그 id의 노드만
    채운다 — 사람이 비워 둔 기존 노드를 제안이 아닌 손이 채우는 일을 막는다. 노드가
    바뀌면 revision을 다시 센다.
    """

    nodes = [
        node.model_copy(update={"config": {**node.config, MODEL_REF_FIELD: model_ref}})
        if (only is None or node.id in only)
        and _asks_for_a_model(node)
        and _is_blank(node.config.get(MODEL_REF_FIELD))
        else node
        for node in spec.nodes
    ]
    if nodes == spec.nodes:
        return spec
    filled = spec.model_copy(update={"nodes": nodes})
    return filled.model_copy(update={"revision": filled.computed_revision()})


__all__ = ["with_model_ref_filled"]
