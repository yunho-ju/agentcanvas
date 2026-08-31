"""실행을 여는 규칙 — 어느 판을 돌리는가, 언제 멈춰 있는가, 사람의 답을 어떻게 잇는가.

HTTP도 SQL도 모른다. 실행 이름·시계·일꾼은 밖에서 주입한다 (시험은 언제나 같은 답을 본다).
실행 자체는 배경에서 흐르므로, 시험은 "그 자리에서 곧장 하는 일꾼"을 넣어 결정론을 지킨다.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from threading import Event
from typing import get_args

import pytest
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import (
    REFUSAL_BY_SNAG,
    RunRefused,
    RunService,
    RunView,
    ThreadKept,
    Work,
)
from agentcanvas_api.run_store import SeqAlreadyStored
from agentcanvas_api.sqlite_job_store import SqliteJobStore
from agentcanvas_api.sqlite_run_store import SqliteRunStore
from agentcanvas_api.store import StoredSpec
from agentcanvas_contracts.agent_spec import AgentSpec, EdgeCondition
from agentcanvas_contracts.run import RUN_ENDINGS, ApprovalAnswer, RunStatus, run_status
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import (
    CannotResume,
    resume_routed_run,
    routed_run,
)

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)

#: 배경 일꾼이 진짜 스레드일 때, 이만큼도 소식이 없으면 시험은 기다리다 통과하지 않고 깨진다.
PATIENCE = 10.0


def example_spec(**overrides) -> AgentSpec:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return AgentSpec.model_validate({**raw, **overrides})


def right_here(work: Work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


class LaterWhenAsked:
    """맡기면 받아만 두는 일꾼 — 시킬 때까지 아무 일도 일어나지 않는다."""

    def __init__(self) -> None:
        self.taken: list[Work] = []

    def __call__(self, work: Work) -> None:
        self.taken.append(work)

    def get_on_with_it(self) -> None:
        for work in self.taken:
            work()
        self.taken = []


def resumes_a_run(events: Sequence[RunEvent]) -> bool:
    return any(event.event_type is EventType.RUN_RESUMED for event in events)


class AlreadyAnswered(InMemoryRunStore):
    """다른 답이 한 발 먼저 재개시킨 저장소 — 답을 잇는 사건은 이미 적힌 순번에 부딪힌다."""

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        if resumes_a_run(events):
            raise SeqAlreadyStored(f"{run_id!r} was resumed by another answer")
        super().append(run_id, events)


class CountsWhatItWasHanded(InMemoryRunStore):
    """무엇을 몇 번에 나눠 받았는지 세는 저장소 — 점진으로 쌓였는지는 받은 쪽이 안다."""

    def __init__(self) -> None:
        super().__init__()
        self.handed: list[int] = []

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        super().append(run_id, events)
        self.handed.append(len(events))


class BreaksWhileTheRunIsFlowing(InMemoryRunStore):
    """흐르던 실행이 예상 밖의 일을 만나는 저장소 — 몇 번째 묶음에서 어그러질지 정해 준다."""

    def __init__(self, breaks_on: int = 3, ever_after: bool = False) -> None:
        super().__init__()
        self._handed = 0
        self._breaks_on = breaks_on
        self._ever_after = ever_after

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        self._handed += 1
        if self._handed == self._breaks_on or (
            self._ever_after and self._handed > self._breaks_on
        ):
            raise RuntimeError("the disk went away")
        super().append(run_id, events)


class FindsTheThirdPlaceTaken(InMemoryRunStore):
    """흐르던 실행이 자기 자리를 남에게 뺏긴 저장소 — 배경에서 부딪히는 자리다."""

    def __init__(self) -> None:
        super().__init__()
        self._handed = 0

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        self._handed += 1
        if self._handed == 3:
            raise SeqAlreadyStored(f"{run_id!r} already has one of those events")
        super().append(run_id, events)


class ForgetsWhereItStopped(InMemoryRunStore):
    """멈춘 자리를 말하지 않는 기록 — 사람이 답해도 이어 달릴 데가 없다."""

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        return [
            event.model_copy(update={"node_id": None})
            if event.event_type is EventType.RUN_PAUSED
            else event
            for event in super().events(run_id, after)
        ]


class TellsOfAnotherRevision(InMemoryRunStore):
    """다른 판의 이야기가 섞인 기록 — 남의 실행에 이 그래프를 이어 붙이지 않는다."""

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        return [
            event.model_copy(update={"spec_revision": "sha256:" + "1" * 64})
            for event in super().events(run_id, after)
        ]


class TellsWhenTheRunSettles(InMemoryRunStore):
    """실행이 멈춰 서거나 끝나면 신호를 올리는 저장소 — 시험은 시계 대신 이 신호를 기다린다."""

    def __init__(self) -> None:
        super().__init__()
        self.settled = Event()

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        super().append(run_id, events)
        if any(run_status([event]) in RUN_ENDINGS for event in events) or any(
            event.event_type is EventType.RUN_PAUSED for event in events
        ):
            self.settled.set()


def a_graph_with_a_condition_nobody_reads() -> AgentSpec:
    """읽을 줄 모르는 조건이 걸린 그래프 — 실행은 그 앞에서 실패로 끝난다."""
    spec = example_spec(version=example_spec().version + 1)
    first, *rest = spec.edges
    muddled = spec.model_copy(
        update={
            "edges": [
                first.model_copy(
                    update={
                        "condition": EdgeCondition(
                            language="cel", expression="route in ['clinical']"
                        )
                    }
                ),
                *rest,
            ]
        }
    )
    return muddled.model_copy(update={"revision": muddled.computed_revision()})


def resumed_in_one_go() -> list[RunEvent]:
    """같은 실행을 한 번에 계산한 것 — 점진으로 쌓인 것과 견주는 기준이다."""
    spec = example_spec()
    held = routed_run(spec, run_id="run_1", started_at=STARTED_AT)
    return resume_routed_run(spec, held, ApprovalAnswer(approved=True))


@pytest.fixture
def specs() -> InMemorySpecStore:
    store = InMemorySpecStore()
    store.append(example_spec(), created_at=STARTED_AT)
    return store


@pytest.fixture
def runs() -> InMemoryRunStore:
    return InMemoryRunStore()


def a_service(
    specs: InMemorySpecStore,
    runs: InMemoryRunStore,
    worker: Callable[[Work], None] = right_here,
) -> RunService:
    return RunService(
        specs=specs,
        runs=runs,
        clock=lambda: STARTED_AT,
        new_run_id=lambda: "run_1",
        worker=worker,
    )


@pytest.fixture
def service(specs: InMemorySpecStore, runs: InMemoryRunStore) -> RunService:
    return a_service(specs, runs)


def started(service: RunService) -> RunView:
    outcome = service.start(SPEC_ID)
    assert isinstance(outcome, RunView)
    return outcome


def test_a_graph_that_was_never_saved_cannot_be_run(service: RunService):
    outcome = service.start("nothing-like-that")

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "unknown_spec"


def test_a_started_run_names_the_graph_and_the_revision_it_runs(service: RunService):
    view = started(service)

    assert view.run.id == "run_1"
    assert view.run.spec_id == SPEC_ID
    assert view.run.spec_revision == example_spec().revision
    assert view.run.created_at == STARTED_AT


def test_a_started_run_is_held_at_the_valve_of_the_example_graph(service: RunService):
    started(service)

    view = service.view("run_1")
    assert view is not None
    assert view.status is RunStatus.PAUSED
    assert service.events("run_1")[-1].event_type is EventType.RUN_PAUSED


def test_the_events_of_a_started_run_are_kept(service: RunService):
    started(service)

    events = service.events("run_1")

    assert events[0].event_type is EventType.RUN_STARTED
    assert [event.seq for event in events] == list(range(len(events)))


def test_asking_for_the_revision_that_is_saved_runs_it(service: RunService):
    outcome = service.start(SPEC_ID, spec_revision=example_spec().revision)

    assert isinstance(outcome, RunView)


def test_an_older_revision_is_not_quietly_run(service: RunService):
    outcome = service.start(SPEC_ID, spec_revision="sha256:" + "0" * 64)

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "stale_revision"
    assert service.view("run_1") is None


def test_a_run_that_was_never_started_cannot_be_looked_at(service: RunService):
    assert service.view("run_nothing") is None
    assert service.events("run_nothing") == []


def test_a_run_that_was_never_started_cannot_be_answered(service: RunService):
    outcome = service.answer("run_nothing", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "unknown_run"


def test_a_run_that_is_not_waiting_for_a_person_cannot_be_answered(
    service: RunService,
):
    started(service)
    service.answer("run_1", ApprovalAnswer(approved=True))

    outcome = service.answer("run_1", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "not_paused"


def test_approving_lets_the_run_flow_to_the_end(service: RunService):
    started(service)

    outcome = service.answer("run_1", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunView)
    assert service.events("run_1")[-1].event_type is EventType.RUN_COMPLETED


def test_what_the_person_filled_in_is_written_on_the_resuming_event(
    service: RunService,
):
    started(service)

    service.answer(
        "run_1", ApprovalAnswer(approved=True, values={"comment": "looks right"})
    )

    resumed = next(
        event
        for event in service.events("run_1")
        if event.event_type is EventType.RUN_RESUMED
    )
    assert resumed.payload["values"] == {"comment": "looks right"}


def test_turning_it_down_closes_the_run_where_it_stood(service: RunService):
    started(service)

    outcome = service.answer("run_1", ApprovalAnswer(approved=False))

    assert isinstance(outcome, RunView)
    assert service.events("run_1")[-1].event_type is EventType.RUN_COMPLETED
    started_nodes = [
        event.node_id
        for event in service.events("run_1")
        if event.event_type is EventType.NODE_STARTED
    ]
    assert "output" not in started_nodes


def test_the_answer_is_added_to_what_already_happened(service: RunService):
    started(service)
    held = len(service.events("run_1"))

    service.answer("run_1", ApprovalAnswer(approved=True))

    events = service.events("run_1")
    assert [event.seq for event in events] == list(range(len(events)))
    assert len(events) > held


def save_a_newer_graph(specs: InMemorySpecStore) -> None:
    changed = example_spec(version=2, name="고친 판")
    specs.append(
        changed.model_copy(update={"revision": changed.computed_revision()}),
        created_at=STARTED_AT,
    )


def test_a_run_is_resumed_on_the_revision_it_started_from(
    service: RunService, specs: InMemorySpecStore
):
    """실행은 한 판의 실행이다 — 그 사이 그래프를 고쳐 저장했어도 시작한 판으로 이어 돈다."""
    started_on = started(service).run.spec_revision
    save_a_newer_graph(specs)

    outcome = service.answer("run_1", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunView)
    assert service.events("run_1")[-1].event_type is EventType.RUN_COMPLETED
    assert {event.spec_revision for event in service.events("run_1")} == {started_on}


def test_a_graph_saved_in_between_does_not_block_the_person_waiting(
    service: RunService, specs: InMemorySpecStore
):
    """밸브 앞에서 고민하는 동안 저장 한 번 했다고 실행이 영영 못 돌아오면 안 된다."""
    started(service)
    save_a_newer_graph(specs)

    assert isinstance(service.answer("run_1", ApprovalAnswer(approved=False)), RunView)


def test_a_run_whose_revision_is_gone_is_refused_instead_of_breaking(
    runs: InMemoryRunStore, specs: InMemorySpecStore
):
    """저장소는 덧붙이기만 하므로 여기까지 오지 않는다 — 그래도 터지지 않고 답으로 물린다."""

    class Forgetful(InMemorySpecStore):
        def by_revision(self, spec_id: str, revision: str) -> None:
            return None

    forgetful = Forgetful()
    forgetful.append(example_spec(), created_at=STARTED_AT)
    service = a_service(forgetful, runs)
    started(service)

    outcome = service.answer("run_1", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "revision_gone"


def test_the_answer_that_came_second_is_refused_not_crashed(
    specs: InMemorySpecStore,
):
    """같은 순간에 온 두 답 중 하나만 이긴다 — 진 쪽은 예외가 아니라 답으로 물린다."""

    service = a_service(specs, AlreadyAnswered())
    started(service)

    outcome = service.answer("run_1", ApprovalAnswer(approved=True))

    assert isinstance(outcome, RunRefused)
    assert outcome.reason == "already_answered"


def test_a_run_held_at_the_valve_has_not_ended(service: RunService):
    started(service)

    assert service.has_ended("run_1") is False


def test_a_run_that_flowed_to_the_end_has_ended(service: RunService):
    started(service)
    service.answer("run_1", ApprovalAnswer(approved=True))

    assert service.has_ended("run_1") is True


def test_a_run_that_was_never_started_has_nothing_more_to_say(service: RunService):
    assert service.has_ended("run_nothing") is True


def test_a_run_writes_down_which_way_the_graph_took(service: RunService):
    """실행은 갈림길을 실제로 탄다 — 어느 길로 갔는지가 실행에 남는다."""
    started(service)

    decided = [
        event
        for event in service.events("run_1")
        if event.event_type is EventType.DECISION_RECORDED
    ]

    assert [event.node_id for event in decided] == ["triage"]
    assert decided[0].payload["route"] == "clinical"


def test_the_runtime_that_opens_a_run_is_the_one_that_was_injected(
    specs: InMemorySpecStore, runs: InMemoryRunStore
):
    """실행기는 갈아끼울 수 있는 자리다 — 서비스는 그것이 내놓은 이벤트를 그대로 남긴다."""

    def one_event_runtime(spec, run_id, clock, given=None):
        yield [
            RunEvent(
                seq=0,
                run_id=run_id,
                event_type=EventType.RUN_COMPLETED,
                timestamp=clock(),
                spec_revision=spec.revision,
                payload={"node_count": 0},
            )
        ]

    service = RunService(
        specs=specs,
        runs=runs,
        clock=lambda: STARTED_AT,
        new_run_id=lambda: "run_1",
        worker=right_here,
        start_run=one_event_runtime,
    )

    outcome = service.start(SPEC_ID)

    assert isinstance(outcome, RunView)
    assert [event.seq for event in service.events("run_1")] == [0]
    assert service.events("run_1")[0].event_type is EventType.RUN_COMPLETED


def test_each_run_gets_its_own_name(specs: InMemorySpecStore, runs: InMemoryRunStore):
    names = iter(["run_1", "run_2"])
    service = RunService(
        specs=specs,
        runs=runs,
        clock=lambda: STARTED_AT,
        new_run_id=lambda: next(names),
        worker=right_here,
    )

    first, second = service.start(SPEC_ID), service.start(SPEC_ID)

    assert isinstance(first, RunView)
    assert isinstance(second, RunView)
    assert {first.run.id, second.run.id} == {"run_1", "run_2"}


def apart_from_when(events: Sequence[RunEvent]) -> list[RunEvent]:
    """언제 일어났는지는 빼고 본다 — 흐르는 실행의 시각은 실측이라 일괄 실행과 다르다."""
    return [event.model_copy(update={"timestamp": STARTED_AT}) for event in events]


class TestARunThatFlowsWhileTheAnswerIsAlreadyBack:
    def test_starting_does_not_wait_for_the_run_to_get_going(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """일꾼이 아직 손도 대지 않았어도 실행을 열어 준 답은 돌아온다."""
        later = LaterWhenAsked()
        service = a_service(specs, runs, worker=later)

        outcome = service.start(SPEC_ID)

        assert isinstance(outcome, RunView)
        assert outcome.status is RunStatus.RUNNING
        assert service.events("run_1") == []

    def test_what_the_worker_does_later_is_the_run_itself(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        later = LaterWhenAsked()
        service = a_service(specs, runs, worker=later)
        service.start(SPEC_ID)

        later.get_on_with_it()

        assert service.events("run_1")[0].event_type is EventType.RUN_STARTED

    def test_the_run_that_was_kept_is_the_one_the_batch_runtime_makes(
        self, service: RunService
    ):
        """점진으로 쌓은 것과 한 번에 계산한 것은 같은 실행이다 (시각만 실측이라 다르다)."""
        started(service)
        service.answer("run_1", ApprovalAnswer(approved=True))

        assert apart_from_when(service.events("run_1")) == apart_from_when(
            resumed_in_one_go()
        )

    def test_the_events_arrive_a_node_at_a_time(self, specs: InMemorySpecStore):
        """듣는 쪽은 실행이 흐르는 동안 본다 — 마지막에 한 번에 쏟아지지 않는다."""
        counting = CountsWhatItWasHanded()
        started(a_service(specs, counting))

        assert len(counting.handed) > 1
        assert sum(counting.handed) == len(counting.events("run_1"))

    def test_a_run_that_stops_at_a_valve_stops_there_in_the_background(
        self, service: RunService
    ):
        started(service)

        view = service.view("run_1")
        assert view is not None
        assert view.status is RunStatus.PAUSED

    def test_a_condition_nobody_reads_ends_the_run_in_the_background(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        specs.append(a_graph_with_a_condition_nobody_reads(), created_at=STARTED_AT)
        service = a_service(specs, runs)

        started(service)

        view = service.view("run_1")
        assert view is not None
        assert view.status is RunStatus.FAILED

    def test_a_run_that_finds_its_place_taken_stops_where_it_stands(
        self, specs: InMemorySpecStore
    ):
        """배경에서 자리를 뺏긴 실행은 조용히 물러난다 — 아무도 읽지 않을 비명을 지르지 않는다."""
        taken = FindsTheThirdPlaceTaken()
        service = a_service(specs, taken)

        outcome = service.start(SPEC_ID)

        assert isinstance(outcome, RunView)
        assert len(taken.events("run_1")) > 0, "부딪히기 전에 쌓인 것은 그대로 남는다"
        assert taken.events("run_1")[-1].event_type is not EventType.RUN_PAUSED

    def test_a_run_that_goes_wrong_in_the_background_ends_as_failed(
        self, specs: InMemorySpecStore
    ):
        """배경에서 어그러진 실행도 끝은 있다 — 영영 흐르는 척하지 않는다."""
        service = a_service(specs, BreaksWhileTheRunIsFlowing())

        outcome = service.start(SPEC_ID)

        assert isinstance(outcome, RunView)
        view = service.view("run_1")
        assert view is not None
        assert view.status is RunStatus.FAILED
        assert service.has_ended("run_1") is True

    def test_what_went_wrong_is_said_without_showing_the_insides(
        self, specs: InMemorySpecStore
    ):
        """사람에게는 무슨 일인지 말해 주되, 속엣말(예외·스택)을 그대로 내보이지 않는다."""
        service = a_service(specs, BreaksWhileTheRunIsFlowing())
        started(service)

        gave_up = service.events("run_1")[-1]

        assert gave_up.event_type is EventType.RUN_FAILED
        assert isinstance(gave_up.payload["message"], str)
        assert "the disk went away" not in str(gave_up.payload)

    def test_a_run_that_goes_wrong_on_its_very_first_step_still_ends(
        self, specs: InMemorySpecStore
    ):
        """첫 묶음부터 어그러져도 끝났다는 사실은 남는다 — 순번은 처음 자리부터다."""
        service = a_service(specs, BreaksWhileTheRunIsFlowing(breaks_on=1))

        started(service)

        assert [event.seq for event in service.events("run_1")] == [0]
        assert service.events("run_1")[0].event_type is EventType.RUN_FAILED

    def test_a_store_that_cannot_be_written_to_at_all_is_let_go(
        self, specs: InMemorySpecStore
    ):
        """끝났다는 말조차 적히지 않으면 그대로 놓아준다 — 끝없이 다시 시도하지 않는다."""
        service = a_service(specs, BreaksWhileTheRunIsFlowing(ever_after=True))

        outcome = service.start(SPEC_ID)

        assert isinstance(outcome, RunView)

    def test_the_worker_that_was_not_given_is_a_background_thread(
        self, specs: InMemorySpecStore
    ):
        """아무도 일꾼을 주지 않으면 실행은 배경 스레드에서 흐른다 — 시험은 신호를 기다린다."""
        store = TellsWhenTheRunSettles()
        service = RunService(
            specs=specs,
            runs=store,
            clock=lambda: STARTED_AT,
            new_run_id=lambda: "run_1",
        )

        service.start(SPEC_ID)

        assert store.settled.wait(PATIENCE), "배경 일꾼이 실행을 끝까지 옮기지 못했다"
        view = service.view("run_1")
        assert view is not None
        assert view.status is RunStatus.PAUSED


class TestAnAnswerThatIsJudgedBeforeItIsCarriedOut:
    def test_the_answer_takes_its_place_before_the_service_answers(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """답을 받아들였다는 자리는 돌려주기 전에 적힌다 — 그래야 두 번째 답이 물릴 수 있다."""
        service = a_service(specs, runs)
        started(service)
        later = LaterWhenAsked()
        service = RunService(
            specs=specs,
            runs=runs,
            clock=lambda: STARTED_AT,
            new_run_id=lambda: "run_1",
            worker=later,
        )

        outcome = service.answer("run_1", ApprovalAnswer(approved=True))

        assert isinstance(outcome, RunView)
        assert service.events("run_1")[-1].event_type is EventType.NODE_COMPLETED
        assert any(
            event.event_type is EventType.RUN_RESUMED
            for event in service.events("run_1")
        )

    def test_the_rest_of_the_run_is_left_to_the_worker(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        started(a_service(specs, runs))
        later = LaterWhenAsked()
        service = a_service(specs, runs, worker=later)
        service.answer("run_1", ApprovalAnswer(approved=True))

        later.get_on_with_it()

        assert service.events("run_1")[-1].event_type is EventType.RUN_COMPLETED

    def test_the_answer_that_came_second_is_refused_even_before_the_worker_runs(
        self, specs: InMemorySpecStore
    ):
        """경합은 그 자리에서 판가름난다 — 진 쪽이 200을 받고 배경에서 조용히 지는 일은 없다."""
        later = LaterWhenAsked()
        service = a_service(specs, AlreadyAnswered(), worker=later)
        started(service)
        later.get_on_with_it()

        outcome = service.answer("run_1", ApprovalAnswer(approved=True))

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "already_answered"
        assert later.taken == [], "물린 답은 배경에 일을 남기지 않는다"


class TestARunThatCannotBeCarriedOn:
    def test_every_reason_the_engine_can_give_has_something_to_say(self):
        """표에 없는 까닭은 KeyError가 되어 500으로 샌다 — 까닭을 늘리면 여기서 먼저 걸린다."""
        assert set(REFUSAL_BY_SNAG) == set(get_args(CannotResume))

    def test_a_run_that_does_not_say_where_it_stopped_is_refused_not_ignored(
        self, specs: InMemorySpecStore
    ):
        """200을 돌려주고 아무 일도 하지 않으면, 답한 사람은 영영 기다린다."""
        service = a_service(specs, ForgetsWhereItStopped())
        started(service)

        outcome = service.answer("run_1", ApprovalAnswer(approved=True))

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "nowhere_to_answer"

    def test_a_run_whose_events_belong_to_another_revision_is_refused(
        self, specs: InMemorySpecStore
    ):
        service = a_service(specs, TellsOfAnotherRevision())
        started(service)

        outcome = service.answer("run_1", ApprovalAnswer(approved=True))

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "another_revision"


def a_second_draft() -> AgentSpec:
    """같은 그래프의 다음 판 — 게시가 가리키는 판과 최신 판을 갈라 놓는다."""
    spec = example_spec(version=example_spec().version + 1, name="A second draft")
    return spec.model_copy(update={"revision": spec.computed_revision()})


def a_service_that_names_each_run(
    specs: InMemorySpecStore, runs: InMemoryRunStore
) -> RunService:
    """한 스레드에 말이 여러 번 오가는 시험 — 실행마다 이름이 달라야 한다."""
    names = iter([f"run_{turn}" for turn in range(1, 10)])
    return RunService(
        specs=specs,
        runs=runs,
        clock=lambda: STARTED_AT,
        new_run_id=lambda: next(names),
        worker=right_here,
    )


def a_turn(
    service: RunService, thread_id: str | None = None, **asked: object
) -> RunView:
    """대화 한 마디 — 게시된 판과 말을 주고받는다."""
    outcome = service.start(
        SPEC_ID, thread_id=thread_id, revision_source="published", **asked
    )
    assert isinstance(outcome, RunView)
    return outcome


class TestRunningTheRevisionThatWasPublished:
    """대화는 게시된 판과 한다 — 판을 집는 쪽은 서버고, 그 판은 대화 도중 움직이지 않는다."""

    def test_a_graph_that_was_never_published_cannot_be_talked_to(
        self, service: RunService
    ):
        """게시하지 않은 그래프에 말을 걸면, 최신 판이 조용히 도는 대신 까닭을 듣는다."""
        outcome = service.start(SPEC_ID, revision_source="published")

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "not_published"

    def test_a_graph_that_was_never_saved_cannot_be_talked_to_either(
        self, service: RunService
    ):
        """없는 그래프는 게시된 판을 물어도 없는 그래프다 — 까닭이 갈리지 않는다."""
        outcome = service.start("nothing-like-that", revision_source="published")

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "unknown_spec"

    def test_the_published_revision_runs_even_though_a_newer_one_is_saved(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """대화 상대는 내놓은 판이다 — 그 뒤로 저장한 초고가 사람 앞에서 돌지 않는다."""
        published = example_spec().revision
        specs.set_publication(SPEC_ID, published, STARTED_AT)
        specs.append(a_second_draft(), created_at=STARTED_AT)
        service = a_service_that_names_each_run(specs, runs)

        view = a_turn(service)

        assert view.run.spec_revision == published
        assert a_second_draft().revision != published

    def test_a_thread_keeps_the_revision_its_first_turn_took(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """대화 도중 다른 판이 게시돼도, 하던 대화는 처음 만난 판과 계속한다."""
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        service = a_service_that_names_each_run(specs, runs)
        first = a_turn(service, thread_id="thread_1")
        newer = a_second_draft()
        specs.append(newer, created_at=STARTED_AT)
        specs.set_publication(SPEC_ID, newer.revision, STARTED_AT)

        second = a_turn(service, thread_id="thread_1")

        assert second.run.spec_revision == first.run.spec_revision

    def test_a_thread_carries_on_after_the_graph_is_taken_down(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """게시를 내려도 이미 하던 대화는 끊기지 않는다 — 새 대화만 열리지 않는다."""
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        service = a_service_that_names_each_run(specs, runs)
        first = a_turn(service, thread_id="thread_1")
        specs.clear_publication(SPEC_ID)

        second = a_turn(service, thread_id="thread_1")

        assert second.run.spec_revision == first.run.spec_revision

    def test_the_revision_is_not_the_callers_to_name(self, specs: InMemorySpecStore):
        """판을 집는 쪽은 서버다 — 판을 함께 적어 보내면 뜻이 부딪히므로 물린다."""
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        service = a_service(specs, InMemoryRunStore())

        outcome = service.start(
            SPEC_ID,
            spec_revision=example_spec().revision,
            revision_source="published",
        )

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "revision_not_yours_to_pick"

    def test_a_conversation_whose_revision_is_gone_is_refused_instead_of_breaking(
        self, runs: InMemoryRunStore
    ):
        """되찾을 수 없는 판이면 터지는 대신 물린다 — 500은 사람에게 아무 말도 해 주지 못한다."""
        specs = ForgetsThePastRevisions()
        specs.append(example_spec(), created_at=STARTED_AT)
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        service = a_service(specs, runs)

        outcome = service.start(SPEC_ID, revision_source="published")

        assert isinstance(outcome, RunRefused)
        assert outcome.reason == "revision_gone"

    def test_a_run_that_asks_for_nothing_still_takes_the_latest_saved_revision(
        self, specs: InMemorySpecStore, service: RunService
    ):
        """게시가 있어도 기본은 그대로다 — 만드는 사람의 시험 실행은 최신 초고를 돈다."""
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        newer = a_second_draft()
        specs.append(newer, created_at=STARTED_AT)

        view = started(service)

        assert view.run.spec_revision == newer.revision


class TestDeletingAConversation:
    """지울 수 있어야 사람들이 안심하고 말을 건다 — 다만 흐르는 말을 반쪽만 지우지는 않는다."""

    def test_a_conversation_that_has_ended_is_deleted_whole(self, service: RunService):
        started(service)
        service.answer("run_1", ApprovalAnswer(approved=True))

        assert service.delete_thread("run_1") is None
        assert service.view("run_1") is None
        assert service.events("run_1") == []
        assert service.runs_in_thread("run_1") == []

    def test_a_conversation_that_is_still_going_is_left_alone(
        self, service: RunService
    ):
        """멈춰 서서 사람을 기다리는 말도 아직 끝난 말이 아니다 — 하나도 지우지 않는다."""
        view = started(service)

        kept = service.delete_thread("run_1")

        assert isinstance(kept, ThreadKept)
        assert service.view("run_1") is not None
        assert service.runs_in_thread("run_1") == [view.run]

    def test_a_conversation_nobody_started_is_deleted_without_complaint(
        self, service: RunService
    ):
        """없는 것을 지워도 탈이 없다 — 두 번 눌러도 같은 답이다."""
        assert service.delete_thread("nobody-here") is None

    def test_one_turn_that_is_still_going_keeps_the_whole_conversation(
        self, specs: InMemorySpecStore, runs: InMemoryRunStore
    ):
        """반쪽만 지워진 대화는 기록도 아니고 없는 것도 아니다."""
        service = a_service_that_names_each_run(specs, runs)
        service.start(SPEC_ID, thread_id="thread_1")
        service.answer("run_1", ApprovalAnswer(approved=True))
        service.start(SPEC_ID, thread_id="thread_1")

        kept = service.delete_thread("thread_1")

        assert isinstance(kept, ThreadKept)
        assert [run.id for run in service.runs_in_thread("thread_1")] == [
            "run_1",
            "run_2",
        ]


class TestARunTheDurableQueueWillCarryOut:
    """실행을 저장해 두고 일꾼이 나중에 집을 때도, 적어 둔 청은 같은 말을 해야 한다."""

    def test_the_stored_command_carries_the_thread_the_speaker_and_the_published_revision(
        self, tmp_path: Path
    ):
        """나중에 일꾼이 읽을 청 — 어느 대화의 누구 말이고, 어느 판을 집었는지가 적혀 있다."""
        specs = InMemorySpecStore()
        specs.append(example_spec(), created_at=STARTED_AT)
        specs.set_publication(SPEC_ID, example_spec().revision, STARTED_AT)
        specs.append(a_second_draft(), created_at=STARTED_AT)
        jobs = SqliteJobStore(tmp_path / "durable.db")
        service = RunService(
            specs=specs,
            runs=SqliteRunStore(tmp_path / "durable.db"),
            clock=lambda: STARTED_AT,
            new_run_id=lambda: "run_1",
            worker=right_here,
            jobs=jobs,
        )

        view = a_turn(service, thread_id="thread_1", end_user_ref="end-user://amy")

        job = jobs.latest_for_reference("run", view.run.id)
        assert job is not None
        assert job.payload["thread_id"] == "thread_1"
        assert job.payload["end_user_ref"] == "end-user://amy"
        assert job.payload["spec_revision"] == example_spec().revision


class ForgetsThePastRevisions(InMemorySpecStore):
    """지나간 판을 되찾아 주지 않는 저장소 — 이론상 없는 자리이나 터지지는 않아야 한다."""

    def by_revision(self, spec_id: str, revision: str) -> StoredSpec | None:
        return None


class TestTheThreadARunBelongsTo:
    """실행은 스레드에 묶인다 — 이름을 주면 그 끈에, 안 주면 홀로 선 끈에."""

    def test_a_run_that_names_no_thread_is_its_own_thread(self, service: RunService):
        view = started(service)

        assert view.run.thread_id == view.run.id

    def test_a_run_that_names_a_thread_is_tied_to_it(self, service: RunService):
        outcome = service.start(SPEC_ID, thread_id="thread_1")

        assert isinstance(outcome, RunView)
        assert outcome.run.thread_id == "thread_1"
        assert service.runs_in_thread("thread_1") == [outcome.run]

    def test_the_one_who_spoke_is_written_on_the_run(self, service: RunService):
        outcome = service.start(SPEC_ID, end_user_ref="end-user://amy")

        assert isinstance(outcome, RunView)
        assert outcome.run.end_user_ref == "end-user://amy"
