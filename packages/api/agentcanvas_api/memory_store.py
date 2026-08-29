"""프로세스가 사는 동안만 기억하는 저장소 — 시험과 시연이 쓰는 자리."""

from __future__ import annotations

from datetime import datetime
from threading import RLock

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.publication import SpecPublication

from .store import (
    RevisionChanged,
    SpecRevision,
    SpecSummary,
    StoredSpec,
    VersionAlreadyStored,
)


class InMemorySpecStore:
    def __init__(self) -> None:
        self._history: dict[str, list[StoredSpec]] = {}
        self._publications: dict[str, SpecPublication] = {}
        self._lock = RLock()

    def append(self, spec: AgentSpec, created_at: datetime) -> StoredSpec:
        with self._lock:
            return self._append_unlocked(spec, created_at)

    def append_if_revision(
        self, spec: AgentSpec, expected_revision: str, created_at: datetime
    ) -> StoredSpec:
        with self._lock:
            latest = self._history.get(spec.id, [])
            current = latest[-1] if latest else None
            if current is None or current.spec.revision != expected_revision:
                raise RevisionChanged(
                    f"{spec.id!r} is no longer at revision {expected_revision!r}"
                )
            return self._append_unlocked(spec, created_at)

    def _append_unlocked(self, spec: AgentSpec, created_at: datetime) -> StoredSpec:
        history = self._history.get(spec.id, [])
        if any(stored.spec.version == spec.version for stored in history):
            raise VersionAlreadyStored(
                f"{spec.id!r} already has a version {spec.version}"
            )
        stored = StoredSpec(spec=spec, created_at=created_at)
        self._history.setdefault(spec.id, []).append(stored)
        return stored

    def latest(self, spec_id: str) -> StoredSpec | None:
        with self._lock:
            history = self._history.get(spec_id)
            return history[-1] if history else None

    def by_revision(self, spec_id: str, revision: str) -> StoredSpec | None:
        with self._lock:
            return next(
                (
                    stored
                    for stored in self._history.get(spec_id, [])
                    if stored.spec.revision == revision
                ),
                None,
            )

    def revisions(self, spec_id: str) -> list[SpecRevision]:
        with self._lock:
            return [
                SpecRevision(
                    version=stored.spec.version,
                    revision=stored.spec.revision,
                    created_at=stored.created_at,
                )
                for stored in reversed(self._history.get(spec_id, []))
            ]

    def summaries(self, limit: int) -> list[SpecSummary]:
        with self._lock:
            latest = [history[-1] for history in self._history.values() if history]
            newest_first = sorted(
                latest, key=lambda stored: stored.created_at, reverse=True
            )
            return [SpecSummary.of(stored) for stored in newest_first[:limit]]

    def publication(self, spec_id: str) -> SpecPublication | None:
        with self._lock:
            return self._publications.get(spec_id)

    def set_publication(
        self, spec_id: str, revision: str, published_at: datetime
    ) -> None:
        with self._lock:
            self._publications[spec_id] = SpecPublication(
                spec_id=spec_id, revision=revision, published_at=published_at
            )

    def clear_publication(self, spec_id: str) -> None:
        with self._lock:
            self._publications.pop(spec_id, None)


__all__ = ["InMemorySpecStore"]
