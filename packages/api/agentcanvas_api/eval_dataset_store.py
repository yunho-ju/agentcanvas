"""데이터셋을 어떻게 되찾는가 — 저장소가 지키는 약속(프로토콜).

EvalDataset은 AgentSpec과 달리 revision을 갖지 않는다(EVAL-1) — 저장은 upsert다:
같은 id로 다시 저장하면 있던 것을 그대로 덮어쓴다. 이력은 남기지 않는다.
"""

from __future__ import annotations

from typing import Protocol

from agentcanvas_contracts.eval_case import EvalDataset
from pydantic import BaseModel


class EvalDatasetSummary(BaseModel):
    """목록 한 줄 — 그 데이터셋을 지금 뭐라고 부르고, 케이스가 몇 개인가."""

    id: str
    name: str
    case_count: int

    @classmethod
    def of(cls, dataset: EvalDataset) -> EvalDatasetSummary:
        """저장돼 있는 데이터셋 하나를 목록 한 줄로 줄인다 — 두 저장소가 같은 줄을 쓴다."""
        return cls(id=dataset.id, name=dataset.name, case_count=len(dataset.cases))


class EvalDatasetStore(Protocol):
    """데이터셋을 쌓아 두는 자리. 이력 없이 upsert한다."""

    def save(self, dataset: EvalDataset) -> EvalDataset:
        """있으면 덮어쓰고, 없으면 새로 둔다."""
        ...

    def get(self, dataset_id: str) -> EvalDataset | None:
        """그 이름의 데이터셋. 저장된 적이 없으면 없다."""
        ...

    def list_summaries(self) -> list[EvalDatasetSummary]:
        """저장된 데이터셋들의 지금 모습."""
        ...

    def delete(self, dataset_id: str) -> bool:
        """그 데이터셋을 지운다 — 지우기 전에 있었으면 참, 없었으면 거짓."""
        ...


__all__ = ["EvalDatasetStore", "EvalDatasetSummary"]
