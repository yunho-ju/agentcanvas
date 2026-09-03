"""Architect가 제안할 수 있는 제한된 증분 patch 계약."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .agent_spec import ContractModel, Edge, Node, ResourceBinding
from .revision import REVISION_PATTERN
from .skill_def import SkillDef

#: 한 patch가 담을 수 있는 작업 수 — 제안 하나가 문서를 통째로 갈아엎지 못하게 하는 한계.
#: 서버가 카탈로그의 skill을 앞에 들일 때도 이 수를 넘지 않는다(계약이 한 자리에서 정한다).
MAX_PATCH_OPERATIONS = 32


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


class AddResourceOperation(ContractModel):
    op: Literal["add_resource"]
    resource: ResourceBinding


class ReplaceResourceOperation(ContractModel):
    """같은 id의 바인딩을 통째로 갈아 끼운다 — 도구 목록까지 새 것이 된다."""

    op: Literal["replace_resource"]
    resource: ResourceBinding


class RemoveResourceOperation(ContractModel):
    op: Literal["remove_resource"]
    resource_id: str = Field(min_length=1)


class AddSkillOperation(ContractModel):
    """문서가 따를 skill 한 장을 들인다 — 본문은 카탈로그의 원문 그대로다.

    모델이 본문을 지어내는 자리가 아니다: 서버가 고른 카탈로그의 SkillDef를 그대로 싣는다
    (제안이 skill을 고르면 그 skill이 함께 들어와야 단계가 없는 것을 입지 않는다).
    """

    op: Literal["add_skill"]
    skill: SkillDef


type PatchOperation = Annotated[
    AddNodeOperation
    | RemoveNodeOperation
    | ReplaceNodeConfigOperation
    | AddEdgeOperation
    | RemoveEdgeOperation
    | AddResourceOperation
    | ReplaceResourceOperation
    | RemoveResourceOperation
    | AddSkillOperation,
    Field(discriminator="op"),
]


class AgentSpecPatch(ContractModel):
    """AgentSpec을 안전하게 바꾸기 위한 순서 있는 작업 목록."""

    schema_version: Literal["agent.patch/v1"]
    base_revision: str = Field(pattern=REVISION_PATTERN)
    operations: list[PatchOperation] = Field(
        min_length=1, max_length=MAX_PATCH_OPERATIONS
    )


__all__ = [
    "MAX_PATCH_OPERATIONS",
    "AddEdgeOperation",
    "AddNodeOperation",
    "AddResourceOperation",
    "AddSkillOperation",
    "AgentSpecPatch",
    "PatchOperation",
    "RemoveEdgeOperation",
    "RemoveNodeOperation",
    "RemoveResourceOperation",
    "ReplaceNodeConfigOperation",
    "ReplaceResourceOperation",
]
