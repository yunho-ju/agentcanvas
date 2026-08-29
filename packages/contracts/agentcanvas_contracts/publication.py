"""게시 — 이 문서가 어느 판을 대화 상대로 내놓았는가 (live-chat vision Slice 2).

게시는 판 하나를 가리키는 가벼운 행위다: 말을 거는 쪽은 언제나 게시된 그 판과 이야기하고,
만드는 쪽이 캔버스를 고쳐도 게시 pointer는 그 판을 그대로 가리킨다. 모델·도구·eval까지
동결하는 release manifest와 다르다 — 여기 담기는 것은 어느 판이 언제 나갔는가뿐이다.
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel, UtcDatetime
from .revision import REVISION_PATTERN


class SpecPublication(ContractModel):
    """지금 이 문서가 대화 상대로 내놓은 판 하나 — 어느 그래프의 어느 판이, 언제부터."""

    spec_id: str = Field(min_length=1)
    revision: str = Field(pattern=REVISION_PATTERN)
    published_at: UtcDatetime


__all__ = ["SpecPublication"]
