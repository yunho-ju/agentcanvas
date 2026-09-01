"""실행을 여는 규칙 — 어느 판을 돌리는가, 지금 멈춰 있는가, 사람의 답을 어떻게 잇는가.

실행기는 주입한다: 기본은 엔진의 갈림길 실행기이고, 갈아끼우는 자리는 생성자 하나다.
실행은 배경에서 흐른다 — 문을 지키는 쪽은 실행이 끝나기를 기다리지 않고, 사건이 나오는 대로
저장소에 쌓인다(듣고 있는 사람은 그것을 흐르는 동안 본다). 일꾼도 이름도 시계도 밖에서 받는다.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.refs import EndUserRef
from agentcanvas_contracts.run import (
    RUN_ENDINGS,
    ApprovalAnswer,
    Run,
    RunStatus,
    run_status,
)
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import (
    CannotResume,
    cannot_resume,
    resume_routed_run_stream,
    routed_run_stream,
)
from pydantic import BaseModel

from .job_store import (
    ConcurrentRunUpdate,
    DurableJob,
    DurableJobStore,
    JobCancelled,
    LeaseLost,
    UnrecoverableJob,
    request_fingerprint,
)
from .run_store import RunStore, SeqAlreadyStored
from .service import Clock, utc_now
from .store import SpecStore, StoredSpec
from .thread_views import ThreadSummary, ThreadTurn, summarize_thread

#: 실행의 이름을 발급하는 것 — 시험은 언제나 같은 이름을 내주는 것을 넣는다.
RunIdMaker = Callable[[], str]

#: 사건 묶음 하나 — 노드 하나가 일하는 동안 일어난 일들이다.
EventBatch = list[RunEvent]

#: 그래프 하나를 돌리며 사건 묶음을 내놓는 것 — 실행기를 갈아끼우는 자리다.
#: 넷째 자리는 실행이 건네받고 여는 값이다 (건넨 것이 없으면 없음).
StartsARun = Callable[
    [AgentSpec, str, Clock, Mapping[str, object] | None], Iterator[EventBatch]
]

#: 멈춰 선 실행에 사람의 답을 이어, 이어지는 사건 묶음만 내놓는 것.
ResumesARun = Callable[
    [AgentSpec, Sequence[RunEvent], ApprovalAnswer, Clock], Iterator[EventBatch]
]

#: 시간이 걸리는 일 하나 — 맡기면 언젠가 끝난다.
Work = Callable[[], None]

#: 그 일을 맡아 하는 일꾼 — 기본은 배경에서 하고, 시험은 그 자리에서 곧장 하는 것을 넣는다.
Worker = Callable[[Work], None]

#: 어느 판을 돌릴지 정하는 법 — 저장된 최신 판인가, 대화 상대로 내놓은(게시된) 판인가.
#: 참·거짓 대신 이름이다: 판을 집는 법이 늘어도 부르는 쪽의 말이 뜻을 잃지 않는다.
RevisionSource = Literal["latest", "published"]


#: 실행이 예상 밖의 일로 어그러졌을 때 남기는 말 — 사람에게는 무슨 일인지, 기계에는 그 종류만.
#: 속엣말(예외 문구·스택)은 담지 않는다: 남의 컴퓨터 속사정을 화면에 흘리지 않는다.
RUN_WENT_WRONG: dict[str, object] = {
    "reason": "runtime_error",
    "message": "something went wrong while this run was flowing, so it stopped here",
}
RUN_WAS_CANCELLED: dict[str, object] = {
    "reason": "cancelled",
    "message": "this run was cancelled before it could finish",
}


def in_the_background(work: Work) -> None:
    """맡은 일을 배경에서 한다 — 문을 지키는 쪽은 실행이 끝나기를 기다리지 않는다."""
    threading.Thread(target=work, daemon=True).start()


def new_run_id() -> str:
    return uuid4().hex


class RunView(BaseModel):
    """사용자에게 돌려줄 실행의 지금 모습 — 실행 하나와, 이벤트가 말하는 상태."""

    run: Run
    status: RunStatus


#: 실행을 물리는 까닭. 없는 그래프인가, 오래된 판인가, 내놓은 판이 없는가, 없는 실행인가,
#: 멈춰 있지 않은가, 다른 답이 한 발 먼저였는가.
RunRefusal = Literal[
    "unknown_spec",
    "stale_revision",
    "not_published",
    "revision_not_yours_to_pick",
    "unknown_run",
    "not_paused",
    "revision_gone",
    "already_answered",
    "nowhere_to_answer",
    "another_revision",
]

#: 이어 달릴 수 없다는 엔진의 말을, 실행을 물리는 까닭과 사람에게 할 말로 옮기는 표.
#: 까닭이 값으로 오므로 답한 사람은 200을 받고 영영 기다리는 일이 없다.
REFUSAL_BY_SNAG: dict[CannotResume, tuple[RunRefusal, str]] = {
    "no_events": ("not_paused", "nothing has happened in it yet"),
    "not_paused": ("not_paused", "it is not waiting for anyone"),
    "nowhere_to_answer": ("nowhere_to_answer", "it does not say where it stopped"),
    "another_revision": (
        "another_revision",
        "what happened in it belongs to another revision of the graph",
    ),
}


@dataclass(frozen=True)
class RunRefused:
    """실행하지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    reason: RunRefusal
    message: str


RunOutcome = RunView | RunRefused


@dataclass(frozen=True)
class ThreadKept:
    """대화를 지우지 않았고, 왜 그런지 — 예외 대신 답으로 돌려준다."""

    message: str


#: 대화를 지운 결과 — 지웠으면 더 할 말이 없고, 남겼으면 왜 남겼는지 말한다.
ThreadDeletion = ThreadKept | None


def _refused_to_carry_on(run_id: str, snag: CannotResume) -> RunRefused:
    """이어 달릴 수 없다는 엔진의 말을 사람에게 할 말로 옮긴다."""
    reason, said = REFUSAL_BY_SNAG[snag]
    return RunRefused(reason=reason, message=f"run {run_id!r} cannot carry on — {said}")


class RunService:
    """실행을 열고, 이벤트를 남기고, 사람의 답을 잇는 일 — HTTP도 SQL도 모른다."""

    def __init__(
        self,
        specs: SpecStore,
        runs: RunStore,
        clock: Clock = utc_now,
        new_run_id: RunIdMaker = new_run_id,
        worker: Worker = in_the_background,
        start_run: StartsARun = routed_run_stream,
        resume_run: ResumesARun = resume_routed_run_stream,
        jobs: DurableJobStore | None = None,
        wake_worker: Callable[[], None] | None = None,
    ) -> None:
        self._specs = specs
        self._runs = runs
        self._clock = clock
        self._new_run_id = new_run_id
        self._worker = worker
        self._start_run = start_run
        self._resume_run = resume_run
        self._jobs = jobs
        self._wake_worker = wake_worker or (lambda: None)

    def start(
        self,
        spec_id: str,
        spec_revision: str | None = None,
        input: Mapping[str, object] | None = None,
        idempotency_key: str | None = None,
        *,
        thread_id: str | None = None,
        end_user_ref: EndUserRef | None = None,
        revision_source: RevisionSource = "latest",
    ) -> RunOutcome:
        """저장된 그래프를 지금 돌린다 — 기본은 서버에 저장된 최신 판이다.

        어느 판을 돌릴지 적어 보냈다면 그 판이 최신일 때만 돈다: 오래된 판을 조용히 돌리지 않는다.
        게시된 판과 말을 주고받을 때는 판을 서버가 집는다 (`revision_source="published"`).
        스레드 이름을 주면 이 실행은 그 대화에 이어 붙는다 — 안 주면 홀로 선 스레드다.
        함께 건넨 값은 실행기에게 그대로 넘어간다 — 그것이 실행이 여는 상태다.
        """
        command = {
            "operation": "start",
            "spec_id": spec_id,
            "spec_revision": spec_revision,
            "input": dict(input) if input is not None else None,
            "thread_id": thread_id,
            "end_user_ref": end_user_ref,
            "revision_source": revision_source,
        }
        fingerprint = request_fingerprint(command)
        if self._jobs is not None and idempotency_key is not None:
            existing = self._jobs.find_by_idempotency(
                idempotency_key,
                fingerprint,
                "run",
                "start",
            )
            if existing is not None:
                accepted_run = self._runs.get(existing.reference_id)
                if accepted_run is None:
                    raise RuntimeError("accepted run is missing")
                return RunView(
                    run=accepted_run,
                    status=run_status(self._runs.events(accepted_run.id)),
                )

        found = (
            self._published_revision(spec_id, spec_revision, thread_id)
            if revision_source == "published"
            else self._latest_revision(spec_id, spec_revision)
        )
        if isinstance(found, RunRefused):
            return found
        spec = found.spec
        run = Run(
            id=self._new_run_id(),
            spec_id=spec.id,
            spec_revision=spec.revision,
            created_at=self._clock(),
            thread_id=thread_id,
            end_user_ref=end_user_ref,
        )
        if self._jobs is not None:
            payload = {
                "operation": "start",
                "spec_id": spec.id,
                "spec_revision": spec.revision,
                "input": command["input"],
                "run_id": run.id,
                "thread_id": run.thread_id,
                "end_user_ref": run.end_user_ref,
            }
            accepted = self._jobs.accept_run(
                run,
                idempotency_key=idempotency_key or uuid4().hex,
                request_fingerprint=fingerprint,
                payload=payload,
                now=run.created_at,
            )
            accepted_run = self._runs.get(accepted.job.reference_id)
            if accepted_run is None:
                raise RuntimeError("accepted run is missing")
            self._wake_worker()
            return RunView(
                run=accepted_run,
                status=run_status(self._runs.events(accepted_run.id)),
            )

        self._runs.start(run)
        # 실행은 배경에서 흐른다 — 여기서 기다리면 노드 하나에 몇 초씩 걸리는 날 문이 막힌다.
        # 아직 아무 일도 일어나지 않았으므로 이 실행은 이제 막 흐르기 시작한 것이다.
        batches = self._start_run(spec, run.id, self._clock, input)
        self._worker(lambda: self._pours(run.id, batches, spec.revision))
        return RunView(run=run, status=run_status([]))

    def _latest_revision(
        self, spec_id: str, spec_revision: str | None
    ) -> StoredSpec | RunRefused:
        """만드는 사람이 돌리는 판 — 언제나 지금 저장된 최신 판이다.

        어느 판을 돌릴 셈이었는지 적어 보냈다면 그것이 최신일 때만 돈다.
        """
        stored = self._specs.latest(spec_id)
        if stored is None:
            return RunRefused(
                reason="unknown_spec", message=f"no graph called {spec_id!r}"
            )
        if spec_revision is not None and spec_revision != stored.spec.revision:
            return RunRefused(
                reason="stale_revision",
                message=f"{spec_id!r} has moved on — its latest revision is"
                f" {stored.spec.revision}",
            )
        return stored

    def _published_revision(
        self, spec_id: str, spec_revision: str | None, thread_id: str | None
    ) -> StoredSpec | RunRefused:
        """말을 거는 사람이 만나는 판 — 이 스레드가 첫 마디에 집은 판이고, 없으면 게시된 판이다.

        대화 도중 다른 판이 게시되거나 게시가 내려가도 하던 대화는 첫 판으로 이어진다:
        게시된 판은 말을 주고받는 동안 움직이지 않는다.
        """
        if self._specs.latest(spec_id) is None:
            return RunRefused(
                reason="unknown_spec", message=f"no graph called {spec_id!r}"
            )
        if spec_revision is not None:
            return RunRefused(
                reason="revision_not_yours_to_pick",
                message="the published graph brings its own revision — do not name one",
            )
        revision = self._revision_the_thread_took(thread_id)
        if revision is None:
            published = self._specs.publication(spec_id)
            if published is None:
                return RunRefused(
                    reason="not_published",
                    message=f"{spec_id!r} is not published, so there is nobody to talk to",
                )
            revision = published.revision
        stored = self._specs.by_revision(spec_id, revision)
        if stored is None:
            # 저장소는 덧붙이기만 하므로 집은 판은 그대로 남아 있다 — 여기까지 오지 않는다.
            return RunRefused(
                reason="revision_gone",
                message="the revision this conversation started on is no longer stored",
            )
        return stored

    def _revision_the_thread_took(self, thread_id: str | None) -> str | None:
        """이 대화가 이미 집은 판 — 첫 마디가 만난 판을 끝까지 쓴다. 첫 마디면 아직 없다."""
        if thread_id is None:
            return None
        so_far = self._runs.runs_in_thread(thread_id)
        return so_far[0].spec_revision if so_far else None

    def _pours(
        self, run_id: str, batches: Iterator[EventBatch], spec_revision: str
    ) -> None:
        """실행이 내놓는 사건 묶음을 나오는 대로 쌓는다 — 듣고 있는 사람은 흐르는 동안 본다.

        누군가 그 자리를 먼저 차지했다면(이론상 도달 불가) 이 실행은 조용히 물러난다:
        아무도 읽지 않을 비명으로 기록을 더럽히지 않는다.
        예상 밖의 일로 어그러지면 실패로 끝맺는다 — 배경에서 죽은 실행이 영영 흐르는 척하면,
        기다리는 사람은 아무 소식도 듣지 못한다.
        """
        try:
            for batch in batches:
                self._runs.append(run_id, batch)
        except SeqAlreadyStored:
            return
        except Exception:  # noqa: BLE001 — 배경 일꾼의 끝자리다: 무슨 일이 나든 끝은 남긴다.
            self._gives_up(run_id, spec_revision)

    def _gives_up(self, run_id: str, spec_revision: str) -> None:
        """어그러진 실행에 끝을 적어 준다 — 무슨 일이었는지는 사람의 말로, 속엣말은 빼고.

        끝났다는 말조차 적히지 않으면(저장소가 통째로 어긋난 자리) 그대로 놓아준다:
        적히지 않는 곳에 다시, 또다시 적으려 들지 않는다.
        """
        last = self._runs.last_event(run_id)
        gave_up = RunEvent(
            seq=0 if last is None else last.seq + 1,
            run_id=run_id,
            event_type=EventType.RUN_FAILED,
            timestamp=self._clock(),
            spec_revision=spec_revision,
            payload=RUN_WENT_WRONG,
        )
        try:
            self._runs.append(run_id, [gave_up])
        except Exception:  # noqa: BLE001 — 적히지 않는 곳이면 더 해 볼 것이 없다.
            return

    def view(self, run_id: str) -> RunView | None:
        """그 실행의 지금 모습 — 상태는 남은 이벤트에서 파생된다."""
        run = self._runs.get(run_id)
        if run is None:
            return None
        return RunView(run=run, status=run_status(self._runs.events(run_id)))

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        return self._runs.events(run_id, after)

    def runs_in_thread(self, thread_id: str) -> list[Run]:
        """한 스레드에 묶인 실행들 — 시작한 순서대로 (말들이 차례로 묶인다)."""
        return self._runs.runs_in_thread(thread_id)

    def threads_of_spec(self, spec_id: str) -> list[ThreadSummary]:
        """한 그래프에서 오간 대화들 — 요약을 곁들여 한 번에 준다.

        요약은 저장된 적이 없다: 화면이 대화마다 되묻지 않도록 여기서 파생해 곁들인다.
        페이지 없이 전량을 준다 — 안쪽 사람 규모 전제이며, 대화가 늘면 응답도
        선형으로 커진다(스레드마다 첫 실행의 이벤트를 읽는다).
        """
        return [
            summarize_thread(
                turns,
                self._runs.events(turns[0].id),
                self._runs.last_event(turns[-1].id),
            )
            for turns in self._runs.threads_of_spec(spec_id)
        ]

    def thread_turns(self, thread_id: str) -> list[ThreadTurn]:
        """한 대화에 쌓인 이벤트 — 말한 순서대로, 실행별로 묶어서.

        흐르는 중에 물어도 답이 온다: 지금까지 쌓인 데까지의 스냅샷이다.
        """
        return [
            ThreadTurn(run=run, events=self._runs.events(run.id))
            for run in self._runs.runs_in_thread(thread_id)
        ]

    def delete_thread(self, thread_id: str) -> ThreadDeletion:
        """대화 하나를 통째로 거둔다 — 지울 수 있어야 사람들이 마음 놓고 말을 건다.

        아직 끝나지 않은 말이 하나라도 있으면 하나도 지우지 않는다: 반쪽만 지워진 대화는
        기록도 아니고 없는 것도 아니다. (끝내려면 먼저 그 실행을 그만두게 한다.)
        없는 대화를 지워도 탈은 없다 — 두 번 눌러도 같은 답이다.
        """
        so_far = self._runs.runs_in_thread(thread_id)
        if any(not self.has_ended(run.id) for run in so_far):
            return ThreadKept(
                message="this conversation is still going, so nothing was deleted"
            )
        if self._jobs is not None:
            self._jobs.forget_runs([run.id for run in so_far])
        self._runs.delete_thread(thread_id)
        return None

    def has_ended(self, run_id: str) -> bool:
        """끝난 실행에는 더 보낼 것도 기다릴 것도 없다 — 마지막 이벤트 하나만 보고 안다.

        시작된 적 없는 실행도 끝난 것으로 답한다 (실행은 지워지지 않으므로, 없다면 더 올 것도 없다).
        """
        last = self._runs.last_event(run_id)
        if last is None:
            return self._runs.get(run_id) is None
        return run_status([last]) in RUN_ENDINGS

    def answer(
        self,
        run_id: str,
        approval: ApprovalAnswer,
        idempotency_key: str | None = None,
    ) -> RunOutcome:
        """밸브 앞에 멈춰 선 실행에 사람이 답한다 — 이어진 이벤트를 남긴다."""
        run = self._runs.get(run_id)
        if run is None:
            return RunRefused(reason="unknown_run", message=f"no run called {run_id!r}")
        approval_payload = approval.model_dump(mode="json")
        fingerprint = request_fingerprint(
            {"operation": "resume", "run_id": run_id, "approval": approval_payload}
        )
        if self._jobs is not None and idempotency_key is not None:
            existing = self._jobs.find_by_idempotency(
                idempotency_key,
                fingerprint,
                "run",
                "resume",
            )
            if existing is not None:
                return RunView(
                    run=run,
                    status=run_status(self._runs.events(run_id)),
                )
        so_far = self._runs.events(run_id)
        if run_status(so_far) is not RunStatus.PAUSED:
            return RunRefused(
                reason="not_paused",
                message=f"run {run_id!r} is not waiting for anyone",
            )
        # 실행은 한 판의 실행이다 — 그 사이 그래프를 고쳐 저장했어도 시작한 판으로 이어 돈다.
        stored = self._specs.by_revision(run.spec_id, run.spec_revision)
        if stored is None:
            # 저장소는 덧붙이기만 하므로 시작한 판은 그대로 남아 있다 — 여기까지 오지 않는다.
            # 그래도 터지는 대신 답으로 물린다 (500은 사용자에게 아무 말도 해 주지 못한다).
            return RunRefused(
                reason="revision_gone",
                message=f"the revision run {run_id!r} started from is no longer stored",
            )
        snag = cannot_resume(stored.spec, so_far)
        if snag is not None:
            # 아무 일도 일어나지 않았다면 그 까닭을 말한다 — 200을 받고 영영 기다리게 두지 않는다.
            return _refused_to_carry_on(run_id, snag)
        carried_on = self._resume_run(stored.spec, so_far, approval, self._clock)
        # 답이 자리를 잡는 일은 여기서 끝난다 — 같은 순간에 온 두 답 중 하나만 이 자리를 얻는다.
        opening = next(carried_on, [])
        if self._jobs is not None:
            try:
                self._jobs.accept_resume(
                    run_id,
                    so_far[-1].seq if so_far else -1,
                    opening,
                    idempotency_key=idempotency_key or uuid4().hex,
                    request_fingerprint=fingerprint,
                    payload={
                        "operation": "resume",
                        "run_id": run_id,
                        "spec_id": run.spec_id,
                        "spec_revision": run.spec_revision,
                        "base_seq": so_far[-1].seq if so_far else -1,
                        "opening_count": len(opening),
                        "approval": approval_payload,
                    },
                    now=self._clock(),
                )
            except ConcurrentRunUpdate:
                return RunRefused(
                    reason="already_answered",
                    message="another answer already resumed this run",
                )
            self._wake_worker()
            return RunView(run=run, status=run_status([*so_far, *opening]))

        try:
            self._runs.append(run_id, opening)
        except SeqAlreadyStored:
            # 같은 순간에 온 두 답 중 하나만 이긴다 — 진 쪽은 터지지 않고 물린다.
            return RunRefused(
                reason="already_answered",
                message="another answer already resumed this run",
            )
        self._worker(lambda: self._pours(run_id, carried_on, run.spec_revision))
        return RunView(run=run, status=run_status([*so_far, *opening]))

    def _terminal_event(self, run: Run, payload: dict[str, object]) -> RunEvent:
        return RunEvent(
            seq=0,
            run_id=run.id,
            event_type=EventType.RUN_FAILED,
            timestamp=self._clock(),
            spec_revision=run.spec_revision,
            payload=payload,
        )

    def execute_durable(
        self,
        job: DurableJob,
        owner: str,
        *,
        lease_is_live: Callable[[], bool] = lambda: True,
    ) -> None:
        """lease를 가진 worker가 저장된 command를 실행해 event와 job을 함께 수렴시킨다."""
        if self._jobs is None or job.kind != "run":
            raise UnrecoverableJob("run durable queue is unavailable")

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
        run = self._runs.get(job.reference_id)
        if run is None:
            raise UnrecoverableJob("accepted run is missing")
        stored = self._specs.by_revision(run.spec_id, run.spec_revision)
        if stored is None:
            raise UnrecoverableJob("accepted run revision is missing")
        existing = self._runs.events(run.id)

        if job.operation == "start":
            if existing:
                raise UnrecoverableJob(
                    "partially persisted run cannot be replayed safely"
                )
            input_value = job.payload.get("input")
            if input_value is not None and not isinstance(input_value, dict):
                raise UnrecoverableJob("run input is malformed")
            batches = self._start_run(stored.spec, run.id, self._clock, input_value)
        elif job.operation == "resume":
            base_seq = int(job.payload["base_seq"])
            opening_count = int(job.payload["opening_count"])
            safe_last_seq = base_seq + opening_count
            if existing and existing[-1].seq > safe_last_seq:
                raise UnrecoverableJob(
                    "partially persisted continuation cannot be replayed safely"
                )
            approval = ApprovalAnswer.model_validate(job.payload["approval"])
            before_opening = [event for event in existing if event.seq <= base_seq]
            batches = self._resume_run(
                stored.spec,
                before_opening,
                approval,
                self._clock,
            )
            require_active_lease()
            next(batches, None)  # acceptance transaction에 이미 저장한 opening batch
        else:
            raise UnrecoverableJob("unknown run operation")

        while True:
            require_active_lease()
            try:
                batch = next(batches)
            except StopIteration:
                break
            require_active_lease()
            ending = next(
                (
                    event.event_type
                    for event in batch
                    if event.event_type
                    in {
                        EventType.RUN_PAUSED,
                        EventType.RUN_COMPLETED,
                        EventType.RUN_FAILED,
                    }
                ),
                None,
            )
            terminal_status = None
            terminal_reason = None
            if ending is not None:
                terminal_status = (
                    "failed" if ending is EventType.RUN_FAILED else "succeeded"
                )
                terminal_reason = (
                    "runtime_error" if ending is EventType.RUN_FAILED else None
                )
            self._jobs.append_run_events(
                job.id,
                owner,
                batch,
                now=self._clock(),
                terminal_status=terminal_status,
                terminal_reason=terminal_reason,
            )
            if ending is not None:
                return
        raise UnrecoverableJob("run segment ended without a terminal event")

    def cancel(self, run_id: str) -> RunView | None:
        run = self._runs.get(run_id)
        if run is None:
            return None
        if self._jobs is not None:
            self._jobs.request_cancel(
                "run",
                run_id,
                self._clock(),
                self._terminal_event(run, RUN_WAS_CANCELLED),
            )
            self._wake_worker()
        return RunView(run=run, status=run_status(self._runs.events(run_id)))

    def cancel_durable_job(self, job: DurableJob, owner: str) -> None:
        if self._jobs is None:
            return
        run = self._runs.get(job.reference_id)
        if run is None:
            raise UnrecoverableJob("accepted run is missing")
        self._jobs.mark_cancelled(
            job.id,
            owner,
            self._clock(),
            self._terminal_event(run, RUN_WAS_CANCELLED),
        )

    def fail_durable_job(self, job: DurableJob, owner: str, reason: str) -> None:
        if self._jobs is None:
            return
        run = self._runs.get(job.reference_id)
        if run is None:
            self._jobs.finish_failed(job.id, owner, self._clock(), reason)
            return
        self._jobs.finish_failed(
            job.id,
            owner,
            self._clock(),
            reason,
            self._terminal_event(run, RUN_WENT_WRONG),
        )


__all__ = [
    "REFUSAL_BY_SNAG",
    "RUN_WENT_WRONG",
    "EventBatch",
    "ResumesARun",
    "RevisionSource",
    "RunIdMaker",
    "RunOutcome",
    "RunRefusal",
    "RunRefused",
    "RunService",
    "RunView",
    "StartsARun",
    "ThreadDeletion",
    "ThreadKept",
    "Work",
    "Worker",
    "in_the_background",
    "new_run_id",
]
