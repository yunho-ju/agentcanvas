"""프로세스가 사는 동안만 기억하는 배치 저장소 — 시험과 시연이 쓰는 자리."""

from __future__ import annotations

from agentcanvas_contracts.eval_result import EvalBatch


class InMemoryEvalBatchStore:
    def __init__(self) -> None:
        self._batches: dict[str, EvalBatch] = {}

    def save(self, batch: EvalBatch) -> None:
        self._batches[batch.id] = batch

    def get(self, batch_id: str) -> EvalBatch | None:
        return self._batches.get(batch_id)

    def list_for_dataset(
        self, dataset_id: str, limit: int | None = None
    ) -> list[EvalBatch]:
        matched = [
            batch for batch in self._batches.values() if batch.dataset_id == dataset_id
        ]
        return matched if limit is None else matched[:limit]

    def latest_for_spec(self, spec_id: str) -> EvalBatch | None:
        for batch in reversed(list(self._batches.values())):
            if batch.spec_id == spec_id:
                return batch
        return None


__all__ = ["InMemoryEvalBatchStore"]
