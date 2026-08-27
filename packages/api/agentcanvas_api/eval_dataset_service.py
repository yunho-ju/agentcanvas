"""데이터셋을 저장하고 되찾는 규칙 — 저장을 물리는 판단은 서비스가, 저장은 store가 한다.

SpecService/SaveRefused와 같은 결이다: 이미 있는가, 남의 것인가를 여기서 가리고,
라우트(app.py)는 그 답을 상태코드 표로 옮기기만 한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.eval_case import EvalDataset

from .eval_dataset_store import EvalDatasetStore, EvalDatasetSummary

#: 저장을 물리는 까닭 — 이미 있는 데이터셋인가, 남의 데이터셋인가, 없는 데이터셋인가.
EvalDatasetRefusal = Literal["already_saved", "id_mismatch", "unknown"]


@dataclass(frozen=True)
class EvalDatasetRefused:
    """저장하지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    reason: EvalDatasetRefusal
    message: str


EvalDatasetSaveOutcome = EvalDataset | EvalDatasetRefused


class EvalDatasetService:
    """데이터셋을 저장하고 되찾는 일 — HTTP도 SQL도 모른다."""

    def __init__(self, store: EvalDatasetStore) -> None:
        self._store = store

    def create(self, dataset: EvalDataset) -> EvalDatasetSaveOutcome:
        """처음 저장하는 데이터셋 — 이미 있는 이름이면 덮어쓰지 않는다."""
        if self._store.get(dataset.id) is not None:
            return EvalDatasetRefused(
                reason="already_saved",
                message=f"{dataset.id!r} is already saved — change it instead",
            )
        return self._store.save(dataset)

    def update(self, dataset_id: str, dataset: EvalDataset) -> EvalDatasetSaveOutcome:
        """이미 있는 데이터셋을 고친다 — 다른 이름을 자처하거나, 없는 이름이면 거절한다."""
        if dataset.id != dataset_id:
            return EvalDatasetRefused(
                reason="id_mismatch",
                message=f"this dataset calls itself {dataset.id!r}, not {dataset_id!r}",
            )
        if self._store.get(dataset_id) is None:
            return EvalDatasetRefused(
                reason="unknown", message=f"no dataset called {dataset_id!r}"
            )
        return self._store.save(dataset)

    def read(self, dataset_id: str) -> EvalDataset | None:
        return self._store.get(dataset_id)

    def list_summaries(self) -> list[EvalDatasetSummary]:
        return self._store.list_summaries()

    def delete(self, dataset_id: str) -> bool:
        """그 데이터셋을 지운다 — 지우기 전에 있었으면 참, 없었으면 거짓."""
        return self._store.delete(dataset_id)


__all__ = [
    "EvalDatasetRefusal",
    "EvalDatasetRefused",
    "EvalDatasetSaveOutcome",
    "EvalDatasetService",
]
