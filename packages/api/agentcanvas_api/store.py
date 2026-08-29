"""저장한 것을 어떻게 되찾는가 — 저장소가 지키는 약속(프로토콜)과 되돌려주는 것들.

저장소는 저장만 안다. 몇 번째 판인지, revision이 무엇인지 정하는 일은 서비스의 몫이고,
여기 오는 AgentSpec은 이미 그 답이 적힌 것이다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.publication import SpecPublication
from pydantic import BaseModel


class VersionAlreadyStored(Exception):
    """이미 저장된 판 번호를 다시 잇으려 했다 — 이력은 고쳐 쓰지 않는다."""


class RevisionChanged(Exception):
    """기대한 최신 판이 이미 바뀌었다 — 조건부 저장을 잇지 않는다."""


class SpecRevision(BaseModel):
    """이력 한 줄 — 언제 몇 번째 판이 어떤 내용으로 저장됐는가."""

    version: int
    revision: str
    created_at: datetime


class StoredSpec(BaseModel):
    """저장돼 있는 그래프 하나와, 그것이 저장된 시각."""

    spec: AgentSpec
    created_at: datetime


class SpecSummary(BaseModel):
    """목록 한 줄 — 그 그래프를 지금 뭐라고 부르고, 언제 몇 번째 판까지 저장했는가."""

    id: str
    name: str | None
    version: int
    revision: str
    saved_at: datetime

    @classmethod
    def of(cls, stored: StoredSpec) -> SpecSummary:
        """저장돼 있는 그래프 하나를 목록 한 줄로 줄인다 — 두 저장소가 같은 줄을 쓴다."""
        return cls(
            id=stored.spec.id,
            name=stored.spec.name,
            version=stored.spec.version,
            revision=stored.spec.revision,
            saved_at=stored.created_at,
        )


class SpecStore(Protocol):
    """그래프를 쌓아 두는 자리. 쌓기만 하고 지우지 않는다 (이력은 고쳐 쓰지 않는다)."""

    def append(self, spec: AgentSpec, created_at: datetime) -> StoredSpec:
        """새 판 하나를 이력 끝에 잇는다.

        한 그래프의 판 번호는 하나뿐이다 — 이미 있는 번호를 다시 이으면
        `VersionAlreadyStored`를 낸다.
        """
        ...

    def append_if_revision(
        self, spec: AgentSpec, expected_revision: str, created_at: datetime
    ) -> StoredSpec:
        """기대한 최신 revision일 때만 새 판을 원자적으로 잇는다.

        최신 판 확인과 append 사이에 다른 writer가 끼면 `RevisionChanged`를 낸다.
        """
        ...

    def latest(self, spec_id: str) -> StoredSpec | None:
        """가장 나중에 저장된 판. 저장된 적이 없으면 없다."""
        ...

    def by_revision(self, spec_id: str, revision: str) -> StoredSpec | None:
        """그 그래프의 그 판. 지나간 판도 그대로 꺼낸다 (그 판으로 시작한 실행이 이어 돌 수 있게)."""
        ...

    def revisions(self, spec_id: str) -> list[SpecRevision]:
        """그 그래프가 지나온 판들 — 최근 것이 앞에 온다."""
        ...

    def summaries(self, limit: int) -> list[SpecSummary]:
        """저장된 그래프들의 지금 모습 — 최근에 저장한 것이 앞에 오고, limit개까지만 온다."""
        ...

    def publication(self, spec_id: str) -> SpecPublication | None:
        """이 문서가 지금 대화 상대로 내놓은 판. 게시한 적이 없으면 없다."""
        ...

    def set_publication(
        self, spec_id: str, revision: str, published_at: datetime
    ) -> None:
        """게시된 판을 이 판으로 둔다 — 문서당 하나뿐이라 있으면 갈아 끼운다(upsert)."""
        ...

    def clear_publication(self, spec_id: str) -> None:
        """게시를 내린다 — 가리키던 판이 없어진다. 없던 것을 내려도 탈은 없다."""
        ...


__all__ = [
    "RevisionChanged",
    "SpecRevision",
    "SpecStore",
    "SpecSummary",
    "StoredSpec",
    "VersionAlreadyStored",
]
