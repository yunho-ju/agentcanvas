"""배치를 도는 규칙 — 데이터셋을 스펙에 대고 케이스×N회 돌려 EvalBatch를 만든다.

RunService와 같은 결을 따른다: 실행은 배경에서 흐르고, 일꾼·모델·시계·이름은 밖에서 받는다.
배경에서 죽으면 기다리는 사람에게도 소식이 가야 한다(run_service.py `_gives_up`과 같은 규율) —
실패한 배치는 in-flight에서 내려가고, 조회가 그 실패를 말한다.
판정(무엇이 통과인가)은 engine의 판정기가 안다 — 어느 판정기가 어느 차례로 설지는 밖에서 받은
이름 목록(ladder)에서 고르고(evaluator_named), 사다리를 딛는 규칙도 engine의 순수 함수가 안다:
새 층을 얹거나 순서를 바꾸는 데 이 파일을 고치지 않는다.
v1 배치는 spec을 그대로 돈다: 모델 이름은 요청에도 결과 계약에도 없다(모델 비교는 v2).
시도가 예외로 어그러지거나 게이트에서 멈추면 그 출력은 빈 문자열이 된다: 기대하는 문구가
빈 문자열에 담겨 있을 수는 없으므로, 판정은 저절로 불통과가 된다 — 따로 갈래를 타지 않는다.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid4

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.eval_case import EvalCase
from agentcanvas_contracts.eval_result import EvalAttempt, EvalBatch, EvalCaseResult
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.evaluation.evaluator import Evaluator
from agentcanvas_engine.evaluation.expected_phrases import EVALUATOR_NAME, passes
from agentcanvas_engine.evaluation.ladder import judged_up_the_ladder
from agentcanvas_engine.evaluation.registry import DEFAULT_EVALUATORS, evaluator_named
from agentcanvas_engine.model_call import ModelCall, says_the_first_way
from agentcanvas_engine.routed_runtime import routed_run, spoken_llm_texts
from pydantic import BaseModel

from .eval_batch_store import EvalBatchStore, EvalBatchSummary
from .eval_dataset_store import EvalDatasetStore
from .job_store import (
    DurableJob,
    DurableJobStore,
    JobCancelled,
    LeaseLost,
    UnrecoverableJob,
    request_fingerprint,
)
from .run_service import Work, Worker, in_the_background
from .service import LIST_LIMIT, Clock, utc_now
from .store import SpecStore

#: 이름 하나를 새로 발급하는 것 — 시험은 언제나 같은 이름을 내주는 것을 넣는다.
IdMaker = Callable[[], str]

#: 시도 한 번을 처음부터 끝까지(또는 멈춰 설 때까지) 돌려 이벤트를 한 번에 받는 것 — routed_run과 같은 자리.
RunsAnAttempt = Callable[
    [AgentSpec, str, datetime, Mapping[str, object] | None, ModelCall], list[RunEvent]
]

#: 배경에서 배치가 죽었을 때 남기는 말 — 사람에게는 무슨 일인지만, 속엣말은 담지 않는다.
BATCH_WENT_WRONG = (
    "something went wrong while this batch was running, so it stopped here"
)
BATCH_WAS_CANCELLED = "this batch was cancelled before it could finish"


def new_id() -> str:
    return uuid4().hex


#: 배치를 물리는 까닭 — 없는 데이터셋인가, 없는 그래프인가, 오래된 판인가.
EvalBatchRefusal = Literal["unknown_dataset", "unknown_spec", "stale_revision"]


@dataclass(frozen=True)
class EvalBatchRefused:
    """시작하지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    reason: EvalBatchRefusal
    message: str


@dataclass(frozen=True)
class EvalBatchStarted:
    """배치가 열렸다 — 이 이름으로 지금의 모습을 물을 수 있다."""

    batch_id: str


EvalBatchStartOutcome = EvalBatchStarted | EvalBatchRefused


@dataclass(frozen=True)
class EvalBatchRunning:
    """아직 완결되지 않았다는 표시 — EvalBatch 계약에는 상태 필드가 없으므로 이 값으로만 있다."""


@dataclass(frozen=True)
class EvalBatchFailed:
    """배경에서 어그러졌다는 표시 — 무슨 일이었는지는 사람의 말로, 속엣말은 빼고."""

    message: str


EvalBatchView = EvalBatch | EvalBatchRunning | EvalBatchFailed | None


class EvalBatchListing(BaseModel):
    """그 데이터셋의 배치 요약 목록과, 이 뒤에 더 있는가 — 잘렸는지는 서버가 세어 말한다."""

    batches: list[EvalBatchSummary]
    has_more: bool


def _final_output_text(spec: AgentSpec, events: Sequence[RunEvent]) -> str:
    """실행이 낸 마지막 말 — 끝까지 돌지 못했으면(멈추거나 실패하면) 빈 문자열이다.

    갈림길이 답한 봉투(길 선택 JSON)는 산출이 아니다 — engine의 `spoken_llm_texts`가
    그 규칙을 안다. 실패 사유는 여기 담기지 않는다(v1) — 판정은 output_text만 보고,
    빈 문자열은 저절로 불통과가 된다.
    """
    if not events or events[-1].event_type is not EventType.RUN_COMPLETED:
        return ""
    spoken = spoken_llm_texts(spec, events)
    return spoken[-1] if spoken else ""


class EvalBatchService:
    """데이터셋을 스펙에 대고 돌려 EvalBatch를 만드는 일 — HTTP도 SQL도 모른다."""

    def __init__(
        self,
        datasets: EvalDatasetStore,
        specs: SpecStore,
        batches: EvalBatchStore,
        model: ModelCall = says_the_first_way,
        clock: Clock = utc_now,
        new_run_id: IdMaker = new_id,
        new_batch_id: IdMaker = new_id,
        worker: Worker = in_the_background,
        run_case: RunsAnAttempt = routed_run,
        jobs: DurableJobStore | None = None,
        wake_worker: Callable[[], None] | None = None,
        evaluators: Mapping[str, Evaluator] = DEFAULT_EVALUATORS,
        ladder: Sequence[str] = (EVALUATOR_NAME,),
    ) -> None:
        self._datasets = datasets
        self._specs = specs
        self._batches = batches
        self._model = model
        self._clock = clock
        self._new_run_id = new_run_id
        self._new_batch_id = new_batch_id
        self._worker = worker
        self._run_case = run_case
        self._jobs = jobs
        self._wake_worker = wake_worker or (lambda: None)
        # 어느 판정기로 어느 차례에 돌지는 밖에서 받은 이름 목록(ladder)이 정한다 — 층을 더하거나
        # 순서를 바꾸는 데 이 파일을 고치지 않는다(OCP). 이름이 매핑에 없으면 배치를 돌려 놓고
        # 뒤늦게 어그러지는 대신 만드는 자리에서 말한다.
        rungs = [_the_evaluator_named(name, evaluators) for name in ladder]
        if not rungs:
            raise ValueError("a judging ladder needs at least a ground floor")
        # 0층은 사다리의 밑동이라 반드시 있다 — 케이스 결과가 이름·판으로 싣는 것도 이 층이다.
        self._evaluator = rungs[0]
        self._higher_rungs = rungs[1:]
        # 아직 완결되지 않은 배치들 — 서버가 다시 뜨면 잊힌다(v1 알려진 한계).
        self._in_flight: set[str] = set()
        # 배경에서 죽은 배치들 — 조회가 running인 척 영영 기다리게 하지 않는다.
        self._failed: dict[str, str] = {}
        self._lock = threading.Lock()

    def start(
        self,
        dataset_id: str,
        spec_id: str,
        spec_revision: str,
        idempotency_key: str | None = None,
    ) -> EvalBatchStartOutcome:
        """저장된 데이터셋을 저장된 스펙의 그 판에 대고 돌린다 — 오래된 판은 조용히 돌리지 않는다."""
        command = {
            "operation": "batch",
            "dataset_id": dataset_id,
            "spec_id": spec_id,
            "spec_revision": spec_revision,
        }
        fingerprint = request_fingerprint(command)
        if self._jobs is not None and idempotency_key is not None:
            existing = self._jobs.find_by_idempotency(
                idempotency_key,
                fingerprint,
                "eval",
                "batch",
            )
            if existing is not None:
                return EvalBatchStarted(batch_id=existing.reference_id)

        dataset = self._datasets.get(dataset_id)
        if dataset is None:
            return EvalBatchRefused(
                reason="unknown_dataset", message=f"no dataset called {dataset_id!r}"
            )
        stored = self._specs.latest(spec_id)
        if stored is None:
            return EvalBatchRefused(
                reason="unknown_spec", message=f"no graph called {spec_id!r}"
            )
        if spec_revision != stored.spec.revision:
            return EvalBatchRefused(
                reason="stale_revision",
                message=f"{spec_id!r} has moved on — its latest revision is"
                f" {stored.spec.revision}",
            )
        batch_id = self._new_batch_id()
        started_at = self._clock()
        if self._jobs is not None:
            case_run_ids = [
                [self._new_run_id() for _ in range(case.runs_per_case)]
                for case in dataset.cases
            ]
            snapshot = {
                "operation": "batch",
                "dataset": dataset.model_dump(mode="json"),
                "spec": stored.spec.model_dump(mode="json"),
            }
            accepted = self._jobs.accept_eval(
                batch_id,
                idempotency_key=idempotency_key or uuid4().hex,
                request_fingerprint=fingerprint,
                payload={
                    **snapshot,
                    "batch_id": batch_id,
                    "started_at": started_at.isoformat(),
                    "case_run_ids": case_run_ids,
                },
                now=started_at,
            )
            self._wake_worker()
            return EvalBatchStarted(batch_id=accepted.job.reference_id)

        with self._lock:
            self._in_flight.add(batch_id)
        self._worker(
            self._runs(batch_id, dataset.id, dataset.cases, stored.spec, started_at)
        )
        return EvalBatchStarted(batch_id=batch_id)

    def _runs(
        self,
        batch_id: str,
        dataset_id: str,
        cases: Sequence[EvalCase],
        spec: AgentSpec,
        started_at: datetime,
    ) -> Work:
        """이 배치가 돌아갈 일 하나 — 일꾼에게 맡길 수 있게 인자 없는 일로 감싼다.

        무엇이 어그러지든(케이스를 도는 중이든, 저장하는 중이든) in-flight에서는 반드시
        내려간다 — 배경에서 죽은 배치가 영영 도는 척하면, 기다리는 사람은 아무 소식도
        듣지 못한다(run_service.py `_pours`/`_gives_up`과 같은 규율).
        """

        def work() -> None:
            try:
                results = [self._runs_case(case, spec) for case in cases]
                batch = EvalBatch(
                    id=batch_id,
                    dataset_id=dataset_id,
                    spec_id=spec.id,
                    spec_revision=spec.revision,
                    started_at=started_at,
                    results=results,
                )
                self._batches.save(batch)
            except Exception:  # noqa: BLE001 — 배경 일꾼의 끝자리다: 무슨 일이 나든 끝은 남긴다.
                with self._lock:
                    self._failed[batch_id] = BATCH_WENT_WRONG
            finally:
                with self._lock:
                    self._in_flight.discard(batch_id)

        return work

    def _runs_case(self, case: EvalCase, spec: AgentSpec) -> EvalCaseResult:
        attempts = [self._runs_attempt(case, spec) for _ in range(case.runs_per_case)]
        return EvalCaseResult(
            case_id=case.id,
            attempts=attempts,
            passed=_case_passed(case, attempts),
            evaluator=self._evaluator.definition.name,
            evaluator_version=self._evaluator.definition.version,
        )

    def _runs_attempt(
        self, case: EvalCase, spec: AgentSpec, run_id: str | None = None
    ) -> EvalAttempt:
        run_id = run_id or self._new_run_id()
        try:
            events = self._run_case(
                spec, run_id, self._clock(), case.input, self._model
            )
        except Exception:  # noqa: BLE001 — 남의 사정으로 배치를 멈추지 않는다: 이 시도만 불통과로 적는다.
            events = []
        output_text = _final_output_text(spec, events)
        verdict = judged_up_the_ladder(
            self._evaluator, self._higher_rungs, case.expected_phrases, output_text
        )
        return EvalAttempt(
            run_id=run_id,
            passed=verdict.passed,
            output_text=output_text,
            missing_phrases=verdict.missing_phrases,
            judged_by=verdict.judged_by,
        )

    def view(self, batch_id: str) -> EvalBatchView:
        """이 배치의 지금 모습 — 돌고 있으면 그렇다고, 죽었으면 그렇다고, 완결됐으면 그 EvalBatch를."""
        completed = self._batches.get(batch_id)
        if completed is not None:
            return completed
        if self._jobs is not None:
            job = self._jobs.latest_for_reference("eval", batch_id)
            if job is None:
                return None
            if job.status in {"queued", "leased"}:
                return EvalBatchRunning()
            if job.status == "cancelled":
                return EvalBatchFailed(message=BATCH_WAS_CANCELLED)
            if job.status == "failed":
                return EvalBatchFailed(message=BATCH_WENT_WRONG)
            return self._batches.get(batch_id)
        with self._lock:
            running = batch_id in self._in_flight
            failed = self._failed.get(batch_id)
        if running:
            return EvalBatchRunning()
        if failed is not None:
            return EvalBatchFailed(message=failed)
        return self._batches.get(batch_id)

    def execute_durable(
        self,
        job: DurableJob,
        owner: str,
        *,
        lease_is_live: Callable[[], bool] = lambda: True,
    ) -> None:
        if self._jobs is None or job.kind != "eval" or job.operation != "batch":
            raise UnrecoverableJob("eval durable queue is unavailable")

        def require_active_lease() -> None:
            if not lease_is_live():
                raise LeaseLost("worker heartbeat lost the job lease")
            current = self._jobs.get(job.id)
            if (
                current is None
                or current.status != "leased"
                or current.lease_owner != owner
                or current.lease_expires_at is None
                or current.lease_expires_at <= self._clock()
            ):
                raise LeaseLost("job lease is no longer current")
            if current.cancel_requested_at is not None:
                raise JobCancelled()

        require_active_lease()
        spec = AgentSpec.model_validate(job.payload["spec"])
        dataset_value = job.payload["dataset"]
        if not isinstance(dataset_value, dict):
            raise UnrecoverableJob("eval dataset snapshot is malformed")
        cases = [EvalCase.model_validate(case) for case in dataset_value["cases"]]
        run_ids_value = job.payload["case_run_ids"]
        if not isinstance(run_ids_value, list) or len(run_ids_value) != len(cases):
            raise UnrecoverableJob("eval attempt identities are malformed")
        results: list[EvalCaseResult] = []
        for case, run_ids in zip(cases, run_ids_value, strict=True):
            if not isinstance(run_ids, list) or len(run_ids) != case.runs_per_case:
                raise UnrecoverableJob("eval attempt identities are malformed")
            attempts: list[EvalAttempt] = []
            for run_id in run_ids:
                require_active_lease()
                attempts.append(self._runs_attempt(case, spec, str(run_id)))
            results.append(
                EvalCaseResult(
                    case_id=case.id,
                    attempts=attempts,
                    passed=_case_passed(case, attempts),
                    evaluator=self._evaluator.definition.name,
                    evaluator_version=self._evaluator.definition.version,
                )
            )
        require_active_lease()
        batch = EvalBatch(
            id=job.reference_id,
            dataset_id=str(dataset_value["id"]),
            spec_id=spec.id,
            spec_revision=spec.revision,
            started_at=datetime.fromisoformat(str(job.payload["started_at"])),
            results=results,
        )
        self._jobs.save_eval_result(job.id, owner, batch, self._clock())

    def cancel(self, batch_id: str) -> EvalBatchView:
        completed = self._batches.get(batch_id)
        if completed is not None:
            return completed
        if self._jobs is None:
            return None
        job = self._jobs.request_cancel("eval", batch_id, self._clock())
        if job is None:
            return None
        self._wake_worker()
        return self.view(batch_id)

    def cancel_durable_job(self, job: DurableJob, owner: str) -> None:
        if self._jobs is not None:
            self._jobs.mark_cancelled(job.id, owner, self._clock())

    def fail_durable_job(self, job: DurableJob, owner: str, reason: str) -> None:
        if self._jobs is not None:
            self._jobs.finish_failed(job.id, owner, self._clock(), reason)

    def list_for_dataset(
        self, dataset_id: str, limit: int = LIST_LIMIT
    ) -> EvalBatchListing | None:
        """그 데이터셋의 배치 요약 목록 — 없는 데이터셋이면 없음(없음과 빈 목록은 다르다).

        상한을 하나 넘겨 저장소에 물어본다(SpecService.summaries와 같은 결) — 한 줄이
        더 오면 뒤에 더 있다는 뜻이다. 저장소가 이미 정렬해 둔 것을 다시 정렬하지 않는다.
        """
        if self._datasets.get(dataset_id) is None:
            return None
        fetched = self._batches.list_for_dataset(dataset_id, limit=limit + 1)
        summaries = [EvalBatchSummary.of(batch) for batch in fetched[:limit]]
        return EvalBatchListing(batches=summaries, has_more=len(fetched) > limit)


def _the_evaluator_named(name: str, evaluators: Mapping[str, Evaluator]) -> Evaluator:
    """사다리에 세울 층 하나 — 건네받은 매핑에 없는 이름은 그 자리에서 말한다."""
    evaluator = evaluator_named(name, evaluators)
    if evaluator is None:
        raise ValueError(f"no evaluator named {name} was handed in")
    return evaluator


def _case_passed(case: EvalCase, attempts: Sequence[EvalAttempt]) -> bool:
    """케이스가 통과했는가 — 시도들의 통과 개수가 passes_needed를 채웠는가."""
    return passes(case, [attempt.passed for attempt in attempts])


__all__ = [
    "BATCH_WENT_WRONG",
    "EvalBatchFailed",
    "EvalBatchListing",
    "EvalBatchRefusal",
    "EvalBatchRefused",
    "EvalBatchRunning",
    "EvalBatchService",
    "EvalBatchStartOutcome",
    "EvalBatchStarted",
    "EvalBatchView",
    "IdMaker",
    "RunsAnAttempt",
    "new_id",
]
