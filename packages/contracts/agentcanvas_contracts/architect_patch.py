"""Architect가 제안할 수 있는 제한된 증분 patch 계약."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .agent_spec import ContractModel, Edge, Node
from .revision import REVISION_PATTERN


class AddNodeOperation(ContractModel):
    op: Literal["add_node"]
    node: Node


class RemoveNodeOperation(ContractModel):
    op: Literal["remove_node"]
    node_id: str = Field(min_length=1)


class ReplaceNodeConfigOperation(ContractModel):
    op: Literal["replace_node_config"]
    node_id: str = Field(min_length=1)
    config: dict[str, object]


class AddEdgeOperation(ContractModel):
    op: Literal["add_edge"]
    edge: Edge


class RemoveEdgeOperation(ContractModel):
    op: Literal["remove_edge"]
    edge_id: str = Field(min_length=1)


type PatchOperation = Annotated[
    AddNodeOperation
    | RemoveNodeOperation
    | ReplaceNodeConfigOperation
    | AddEdgeOperation
    | RemoveEdgeOperation,
    Field(discriminator="op"),
]


class AgentSpecPatch(ContractModel):
    """AgentSpec을 안전하게 바꾸기 위한 순서 있는 작업 목록."""

    schema_version: Literal["agent.patch/v1"]
    base_revision: str = Field(pattern=REVISION_PATTERN)
    operations: list[PatchOperation] = Field(min_length=1, max_length=32)


__all__ = [
    "AddEdgeOperation",
    "AddNodeOperation",
    "AgentSpecPatch",
    "PatchOperation",
    "RemoveEdgeOperation",
    "RemoveNodeOperation",
    "ReplaceNodeConfigOperation",
]
