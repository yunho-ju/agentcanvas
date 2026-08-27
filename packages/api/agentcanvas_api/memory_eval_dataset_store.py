"""프로세스가 사는 동안만 기억하는 데이터셋 저장소 — 시험과 시연이 쓰는 자리."""

from __future__ import annotations

from agentcanvas_contracts.eval_case import EvalDataset

from .eval_dataset_store import EvalDatasetSummary


class InMemoryEvalDatasetStore:
    def __init__(self) -> None:
        self._datasets: dict[str, EvalDataset] = {}

    def save(self, dataset: EvalDataset) -> EvalDataset:
        self._datasets[dataset.id] = dataset
        return dataset

    def get(self, dataset_id: str) -> EvalDataset | None:
        return self._datasets.get(dataset_id)

    def list_summaries(self) -> list[EvalDatasetSummary]:
        return [EvalDatasetSummary.of(dataset) for dataset in self._datasets.values()]

    def delete(self, dataset_id: str) -> bool:
        return self._datasets.pop(dataset_id, None) is not None


__all__ = ["InMemoryEvalDatasetStore"]
