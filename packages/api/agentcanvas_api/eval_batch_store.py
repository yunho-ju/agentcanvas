"""배치를 어떻게 되찾는가 — 저장소가 지키는 약속(프로토콜).

저장소는 완결된 EvalBatch만 안다 — 어느 시점에 저장할지는 배치 서비스의 몫이다.
쌓기만 하고 지우지 않는다: 지나간 배치는 고쳐 쓰지 않는다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from agentcanvas_contracts.eval_result import EvalBatch
from pydantic import BaseModel


class EvalBatchSummary(BaseModel):
    """목록 한 줄 — 언제 돈 배치이고, 케이스가 몇 개 중 몇 개 통과했는가. output_text 전문은 담지 않는다."""

    id: str
    started_at: datetime
    case_count: int
    passed_count: int

    @classmethod
    def of(cls, batch: EvalBatch) -> EvalBatchSummary:
        """완결된 배치 하나를 목록 한 줄로 줄인다."""
        return cls(
            id=batch.id,
            started_at=batch.started_at,
            case_count=len(batch.results),
            passed_count=sum(1 for result in batch.results if result.passed),
        )


class EvalBatchStore(Protocol):
    """완결된 배치를 쌓아 두는 자리."""

    def save(self, batch: EvalBatch) -> None:
        """완결된 배치 하나를 쌓는다."""
        ...

    def get(self, batch_id: str) -> EvalBatch | None:
        """그 이름의 배치. 저장된 적이 없으면 없다."""
        ...

    def list_for_dataset(
        self, dataset_id: str, limit: int | None = None
    ) -> list[EvalBatch]:
        """그 데이터셋을 돌린 배치들 — 저장된 순서대로. limit을 주면 그 개수까지만 가져온다.

        limit은 순수 성능 자리다: 순서를 바꾸지 않는다 — 저장소가 이미 정렬해 두므로,
        가져오는 개수만 줄인다(정렬 자체는 다시 하지 않는다).
        """
        ...


__all__ = ["EvalBatchStore", "EvalBatchSummary"]
