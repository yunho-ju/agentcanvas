"""사람이 읽는 문구는 언어마다 하나씩 — 계약이 두 언어를 모두 들고 다닌다."""

from __future__ import annotations

from .agent_spec import ContractModel, NonEmptyText


class LocalizedText(ContractModel):
    """화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다."""

    ko: NonEmptyText
    en: NonEmptyText


__all__ = ["LocalizedText"]
