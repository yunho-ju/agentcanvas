"""순수한 AgentSpec patch 적용 — 저장·provider·HTTP와 분리된 안전 경계."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec, AgentStatus, Edge, Node
from agentcanvas_contracts.architect_patch import (
    AddEdgeOperation,
    AddNodeOperation,
    AgentSpecPatch,
    RemoveEdgeOperation,
    RemoveNodeOperation,
    ReplaceNodeConfigOperation,
)

type PatchApplyReason = Literal[
    "invalid_base_revision",
    "stale_revision",
    "duplicate_node",
    "unknown_node",
    "attached_node",
    "duplicate_edge",
    "unknown_edge",
]


@dataclass(frozen=True)
class PatchApplyError(ValueError):
    """patch를 적용하지 않았고, caller가 안전하게 분류할 수 있는 까닭."""

    reason: PatchApplyReason
    message: str

    def __str__(self) -> str:
        return self.message


def _node_index(nodes: list[Node], node_id: str) -> int | None:
    for index, node in enumerate(nodes):
        if node.id == node_id:
            return index
    return None


def _edge_index(edges: list[Edge], edge_id: str) -> int | None:
    for index, edge in enumerate(edges):
        if edge.id == edge_id:
            return index
    return None


def apply_patch(base: AgentSpec, patch: AgentSpecPatch) -> AgentSpec:
    """작업을 적힌 순서대로 적용해 새 draft를 만든다.

    `base`와 `patch` 어느 쪽도 변이하지 않는다. patch가 중간에 거부되면 candidate도
    만들어 반환하지 않고, caller가 저장·publish를 시도할 수 없는 값으로 끝낸다.
    """

    if base.revision != base.computed_revision():
        raise PatchApplyError(
            reason="invalid_base_revision",
            message="the base graph revision does not match its content",
        )
    if base.revision != patch.base_revision:
        raise PatchApplyError(
            reason="stale_revision",
            message="the patch was based on a different graph revision",
        )

    nodes = [node.model_copy(deep=True) for node in base.nodes]
    edges = [edge.model_copy(deep=True) for edge in base.edges]

    for operation in patch.operations:
        if isinstance(operation, AddNodeOperation):
            if _node_index(nodes, operation.node.id) is not None:
                raise PatchApplyError(
                    reason="duplicate_node",
                    message=f"node id {operation.node.id!r} is already in the graph",
                )
            nodes.append(operation.node.model_copy(deep=True))
            continue

        if isinstance(operation, RemoveNodeOperation):
            index = _node_index(nodes, operation.node_id)
            if index is None:
                raise PatchApplyError(
                    reason="unknown_node",
                    message=f"node id {operation.node_id!r} is not in the graph",
                )
            if any(
                edge.source.node == operation.node_id
                or edge.target.node == operation.node_id
                for edge in edges
            ):
                raise PatchApplyError(
                    reason="attached_node",
                    message=(
                        f"node id {operation.node_id!r} still has attached edges; "
                        "remove those edges first"
                    ),
                )
            nodes.pop(index)
            continue

        if isinstance(operation, ReplaceNodeConfigOperation):
            index = _node_index(nodes, operation.node_id)
            if index is None:
                raise PatchApplyError(
                    reason="unknown_node",
                    message=f"node id {operation.node_id!r} is not in the graph",
                )
            nodes[index] = nodes[index].model_copy(
                update={"config": deepcopy(operation.config)}
            )
            continue

        if isinstance(operation, AddEdgeOperation):
            if _edge_index(edges, operation.edge.id) is not None:
                raise PatchApplyError(
                    reason="duplicate_edge",
                    message=f"edge id {operation.edge.id!r} is already in the graph",
                )
            edges.append(operation.edge.model_copy(deep=True))
            continue

        if isinstance(operation, RemoveEdgeOperation):
            index = _edge_index(edges, operation.edge_id)
            if index is None:
                raise PatchApplyError(
                    reason="unknown_edge",
                    message=f"edge id {operation.edge_id!r} is not in the graph",
                )
            edges.pop(index)

    numbered = base.model_copy(
        deep=True,
        update={
            "nodes": nodes,
            "edges": edges,
            "version": base.version + 1,
            "status": AgentStatus.DRAFT,
        },
    )
    return numbered.model_copy(update={"revision": numbered.computed_revision()})


__all__ = ["PatchApplyError", "PatchApplyReason", "apply_patch"]
