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
    Work,
)
from agentcanvas_api.run_store import SeqAlreadyStored
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
