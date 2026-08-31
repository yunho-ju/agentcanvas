"""판을 매기는 규칙 — 몇 번째 판인지, revision이 무엇인지는 오직 여기서 정해진다.

revision은 계약이 정한 값(`AgentSpec.computed_revision()`)만 쓴다. 여기서 해시를 만들지 않는다.
클라이언트가 적어 보낸 version·revision은 읽지 않는다: 판을 매기는 권위는 서버에 있다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.publication import SpecPublication
from agentcanvas_engine.validator import ValidationIssue, validate_graph
from pydantic import BaseModel

from .store import (
    RevisionChanged,
    SpecRevision,
    SpecStore,
    SpecSummary,
    StoredSpec,
)

Clock = Callable[[], datetime]

FIRST_VERSION = 1

#: 목록으로 한 번에 돌려주는 문서의 최대 개수. 그보다 오래된 것은 아직 보여주지 못한다 —
#: 뒤에 더 있다는 사실은 서버가 세어 `has_more`로 말한다 (조용한 절단 금지).
LIST_LIMIT = 200


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class SpecView:
    """사용자에게 돌려줄 그래프의 지금 모습 — 저장된 그래프와, 아직 손볼 곳."""

    stored: StoredSpec
    issues: list[ValidationIssue]


class SpecListing(BaseModel):
    """저장해 둔 문서들의 목록과, 이 뒤에 더 있는가 — 잘렸는지는 서버가 세어 말한다."""

    documents: list[SpecSummary]
    has_more: bool


#: 저장을 물리는 까닭. 이미 있는 그래프인가, 없는 그래프인가, 남의 그래프인가.
Refusal = Literal[
    "already_saved",
    "unknown",
    "id_mismatch",
    "missing_revision",
    "stale_revision",
]


@dataclass(frozen=True)
class SaveRefused:
    """저장하지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    reason: Refusal
    message: str


SaveOutcome = SpecView | SaveRefused


#: 게시를 물리는 까닭. 없는 그래프인가, 저장된 적 없는 판인가 (게시는 저장된 판만 가리킨다).
PublishRefusal = Literal["unknown", "unknown_revision"]


@dataclass(frozen=True)
class PublishRefused:
    """게시하지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    reason: PublishRefusal
    message: str


PublishOutcome = SpecPublication | PublishRefused


def _stamped(spec: AgentSpec, version: int) -> AgentSpec:
    """이 판의 번호를 매기고, 그 내용으로 revision을 다시 계산해 적는다."""
    numbered = spec.model_copy(update={"version": version})
    return numbered.model_copy(update={"revision": numbered.computed_revision()})


class SpecService:
    """그래프를 저장하고 되찾는 일 — HTTP도 SQL도 모른다."""

    def __init__(self, store: SpecStore, clock: Clock = utc_now) -> None:
        self._store = store
        self._clock = clock

    def latest(self, spec_id: str) -> StoredSpec | None:
        return self._store.latest(spec_id)

    def read(self, spec_id: str) -> SpecView | None:
        """저장된 그래프를 지금의 눈으로 다시 본다 — 손볼 곳은 읽는 순간 다시 잰다."""
        stored = self._store.latest(spec_id)
        if stored is None:
            return None
        return SpecView(stored=stored, issues=validate_graph(stored.spec))

    def read_revision(self, spec_id: str, revision: str) -> SpecView | None:
        """지나간 판 하나를 그대로 다시 본다 — 손볼 곳은 읽는 순간 다시 잰다.

        대화는 게시된 판과 오간다: 그 판이 어떤 그래프였는지 여기서 열어 본다.
        """
        stored = self._store.by_revision(spec_id, revision)
        if stored is None:
            return None
        return SpecView(stored=stored, issues=validate_graph(stored.spec))

    def revisions(self, spec_id: str) -> list[SpecRevision]:
        return self._store.revisions(spec_id)

    def summaries(self, limit: int = LIST_LIMIT) -> SpecListing:
        """저장해 둔 문서들 — 최근에 저장한 것부터, 상한까지만.

        상한을 하나 넘겨 물어 본다: 한 줄이 더 오면 뒤에 더 있다는 뜻이다.
        잘렸는지를 세는 일은 여기서 끝난다 — 화면이 개수를 보고 짐작하지 않는다.
        """
        found = self._store.summaries(limit + 1)
        return SpecListing(documents=found[:limit], has_more=len(found) > limit)

    def create(self, spec: AgentSpec) -> SaveOutcome:
        """처음 저장하는 그래프 — 첫 판이다. 이미 있는 그래프는 덮어쓰지 않는다."""
        if self._store.latest(spec.id) is not None:
            return SaveRefused(
                reason="already_saved",
                message=f"{spec.id!r} is already saved — change it instead",
            )
        return self._save(_stamped(spec, FIRST_VERSION))

    def update(
        self,
        spec_id: str,
        spec: AgentSpec,
        expected_revision: str | None = None,
    ) -> SaveOutcome:
        """이미 있는 그래프를 고친다. 달라진 것이 없으면 새 판을 만들지 않는다.

        새 판은 언제나 **그 그래프의** 다음 판이다: 고칠 그래프는 이름으로 찾고,
        들어온 내용이 다른 그래프의 것이면 저장하지 않는다.
        판 번호는 내용이 아니므로, 같은 내용인지 볼 때는 지금 판 번호를 그대로 두고 견준다.
        """
        if spec.id != spec_id:
            return SaveRefused(
                reason="id_mismatch",
                message=f"this graph calls itself {spec.id!r}, not {spec_id!r}",
            )
        current = self._store.latest(spec_id)
        if current is None:
            return SaveRefused(reason="unknown", message=f"no graph called {spec_id!r}")
        if expected_revision is None:
            return SaveRefused(
                reason="missing_revision",
                message="an If-Match revision is required to change a saved graph",
            )
        if expected_revision != current.spec.revision:
            return SaveRefused(
                reason="stale_revision",
                message="the graph changed since it was opened; nothing was overwritten",
            )
        as_it_stands = _stamped(spec, current.spec.version)
        if as_it_stands.revision == current.spec.revision:
            return SpecView(stored=current, issues=validate_graph(current.spec))
        next_spec = _stamped(spec, current.spec.version + 1)
        try:
            stored = self._store.append_if_revision(
                next_spec,
                expected_revision=expected_revision,
                created_at=self._clock(),
            )
        except RevisionChanged:
            return SaveRefused(
                reason="stale_revision",
                message="the graph changed since it was opened; nothing was overwritten",
            )
        return SpecView(stored=stored, issues=validate_graph(next_spec))

    def publication(self, spec_id: str) -> SpecPublication | None:
        """이 문서가 지금 대화 상대로 내놓은 판 — CHAT-3의 채팅이 이걸로 판을 집는다."""
        return self._store.publication(spec_id)

    def publish(self, spec_id: str, revision: str | None = None) -> PublishOutcome:
        """저장된 판 하나를 게시한다 — 게시는 저장된 판을 가리킨다(없는 판을 가리키지 않는다).

        판을 적어 보내지 않으면 지금 저장된 최신 판을 게시한다. 이미 게시됐으면 갈아 끼운다.
        """
        latest = self._store.latest(spec_id)
        if latest is None:
            return PublishRefused(
                reason="unknown", message=f"no graph called {spec_id!r}"
            )
        target = revision if revision is not None else latest.spec.revision
        if self._store.by_revision(spec_id, target) is None:
            return PublishRefused(
                reason="unknown_revision",
                message="you can only publish a version you have saved",
            )
        self._store.set_publication(spec_id, target, self._clock())
        published = self._store.publication(spec_id)
        if published is None:  # 방금 둔 것이 사라지는 자리는 없다.
            raise RuntimeError("the publication went missing right after it was set")
        return published

    def unpublish(self, spec_id: str) -> None:
        """게시를 내린다 — 가리키던 판이 없어진다. 없던 것을 내려도 탈은 없다."""
        self._store.clear_publication(spec_id)

    def _save(self, spec: AgentSpec) -> SpecView:
        # 아직 손볼 곳이 있어도 저장은 된다 — 저장은 벌이 아니다.
        issues = validate_graph(spec)
        stored = self._store.append(spec, created_at=self._clock())
        return SpecView(stored=stored, issues=issues)


__all__ = [
    "FIRST_VERSION",
    "LIST_LIMIT",
    "Clock",
    "PublishOutcome",
    "PublishRefusal",
    "PublishRefused",
    "Refusal",
    "SaveOutcome",
    "SaveRefused",
    "SpecListing",
    "SpecService",
    "SpecView",
    "utc_now",
]
