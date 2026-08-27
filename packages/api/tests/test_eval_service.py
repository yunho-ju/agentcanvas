"""배치를 도는 규칙 — 데이터셋·판을 확인하고, 케이스마다 정해진 횟수만큼 순차로 돌려 EvalBatch를 낸다.

HTTP도 SQL도 모른다. 모델·시계·id·일꾼은 밖에서 주입한다(시험은 언제나 같은 답을 본다).
모델이 어그러지거나(예외) 게이트에서 멈추면 그 시도만 불통과로 적고, 배치는 계속 돈다.
v1 배치는 spec을 그대로 돈다 — model은 요청에도 결과 계약에도 없다(모델 비교는 v2).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest
from agentcanvas_api.eval_batch_store import EvalBatchStore
from agentcanvas_api.eval_service import (
    EvalBatchFailed,
    EvalBatchRefused,
    EvalBatchRunning,
    EvalBatchService,
    EvalBatchStarted,
)
from agentcanvas_api.memory_eval_batch_store import InMemoryEvalBatchStore
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Edge,
    EdgeCondition,
    EdgeEndpoint,
    EdgeKind,
    Node,
    Position,
)
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset
from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.evaluator_catalog import EvaluatorDef
from agentcanvas_engine.evaluation.evaluator import Evaluator, Judgement
from agentcanvas_engine.evaluation.expected_phrases import (
    EVALUATOR_NAME,
    judge_expected_phrases,
)
from agentcanvas_engine.model_call import ModelAsk, ModelSaid

STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
SPEC_ID = "greeter"


class Ticking:
    """한 걸음에 1분씩 가는 시계 — 시간은 밖에서 주입한다."""

    def __init__(self) -> None:
        self._steps = count()

    def __call__(self) -> datetime:
        return STARTED_AT + timedelta(minutes=next(self._steps))


def right_here(work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


def counting_ids(prefix: str):
    """부르는 대로 순서 있는 이름을 내주는 것 — 시험은 언제나 같은 이름을 본다."""
    numbers = count(1)
    return lambda: f"{prefix}-{next(numbers)}"


def a_node(node_id: str, node_type: str = "llm.agent") -> Node:
    return Node(id=node_id, type=node_type, position=Position(x=0, y=0), config={})


def an_edge(
    edge_id: str,
    source: str,
    target: str,
    *,
    source_port: str = "output",
    target_port: str = "input",
    expression: str | None = None,
) -> Edge:
    return Edge(
        id=edge_id,
        kind=EdgeKind.DATA,
        source=EdgeEndpoint(node=source, port=source_port),
        target=EdgeEndpoint(node=target, port=target_port),
        condition=(
            None
            if expression is None
            else EdgeCondition(language="cel", expression=expression)
        ),
    )


def a_greeter_spec(nodes: list[Node], edges: list[Edge] | None = None) -> AgentSpec:
    """한 노드가 말하는 그래프 — 판정은 그 말에 기대하는 문구가 있는지 본다."""
    return AgentSpec(
        schema_version="agent.spec/v1",
        id=SPEC_ID,
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema={"type": "object", "properties": {"route": {}, "note": {}}},
        nodes=nodes,
        edges=edges or [],
    )


def a_case(**overrides) -> EvalCase:
    base = {
        "id": "greeting",
        "title": "반갑다는 인사",
        "input": {},
        "expected_phrases": ["반갑습니다"],
        "runs_per_case": 1,
        "passes_needed": 1,
    }
    return EvalCase.model_validate({**base, **overrides})


class Says:
    """언제나 같은 말을 하는 모델 — 시험은 이 말이 판정에 쓰였는지 본다."""

    def __init__(self, text: str) -> None:
        self._text = text

    def __call__(self, ask: ModelAsk) -> ModelSaid:
        return ModelSaid(input_tokens=7, output_tokens=3, text=self._text)


class RaisesOnceThenSays:
    """처음 한 번은 어그러지고, 그 뒤로는 같은 말을 하는 모델 — 시험은 뒤의 시도가 이어지는지 본다."""

    def __init__(self, text: str) -> None:
        self._text = text
        self._calls = 0

    def __call__(self, ask: ModelAsk) -> ModelSaid:
        self._calls += 1
        if self._calls == 1:
            raise RuntimeError("the model went away")
        return ModelSaid(input_tokens=7, output_tokens=3, text=self._text)


def routes_after_writing(ask: ModelAsk) -> ModelSaid:
    """길을 고르는 노드는 고른 길을 봉투(JSON)에 담아 말하고, 말하는 노드는 반갑다고 말한다."""
    if ask.ways:
        return ModelSaid(
            input_tokens=1,
            output_tokens=1,
            way=ask.ways[0],
            text=json.dumps({"way": ask.ways[0]}),
        )
    return ModelSaid(input_tokens=1, output_tokens=1, text="반갑습니다")


class BreaksWhileSaving(InMemoryEvalBatchStore):
    """배경에서 배치를 저장하다 어그러지는 저장소 — 기다리는 사람에게도 실패가 보여야 한다."""

    def save(self, batch: EvalBatch) -> None:
        raise RuntimeError("the disk went away")


@pytest.fixture
def specs() -> InMemorySpecStore:
    return InMemorySpecStore()


@pytest.fixture
def datasets() -> InMemoryEvalDatasetStore:
    return InMemoryEvalDatasetStore()


@pytest.fixture
def batches() -> InMemoryEvalBatchStore:
    return InMemoryEvalBatchStore()


def a_service(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: EvalBatchStore,
    model=None,
    evaluators: Mapping[str, Evaluator] | None = None,
) -> EvalBatchService:
    return EvalBatchService(
        datasets=datasets,
        specs=specs,
        batches=batches,
        model=model if model is not None else Says("반갑습니다"),
        clock=Ticking(),
        new_run_id=counting_ids("run"),
        new_batch_id=counting_ids("batch"),
        worker=right_here,
        **({} if evaluators is None else {"evaluators": evaluators}),
    )


def a_stand_in_evaluator(name: str) -> Evaluator:
    """이 시험 파일에만 있는 판정기 — engine·api 어느 파일도 이 이름을 알지 못한다.

    답의 글자 수만 세는 판정이라, expected_phrases와는 다른 답을 낸다: 판정이 정말
    이 자리에서 나왔는지 결과만 보고도 알 수 있다.
    """
    return Evaluator(
        definition=EvaluatorDef.model_validate(
            {
                "name": name,
                "version": "v9",
                "plain_description": {
                    "ko": "언제나 틀렸다고 해요",
                    "en": "Always says no",
                },
                "example": {"ko": "무슨 답이든 불통과예요", "en": "Any answer fails"},
            }
        ),
        judge=lambda expected_phrases, output_text: Judgement(
            passed=False, missing_phrases=["이 판정기가 적은 까닭"]
        ),
    )


def test_a_case_is_run_exactly_runs_per_case_times(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B4: 케이스별 attempts 수는 정확히 runs_per_case개다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(
            id="greetings",
            name="인사",
            cases=[a_case(runs_per_case=3, passes_needed=1)],
        )
    )
    service = a_service(specs, datasets, batches)

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    assert len(batch.results) == 1
    assert len(batch.results[0].attempts) == 3
    assert [attempt.run_id for attempt in batch.results[0].attempts] == [
        "run-1",
        "run-2",
        "run-3",
    ]


def test_an_attempt_that_raises_fails_alone_and_the_batch_carries_on(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B5: 모델이 예외로 어그러진 시도만 불통과로 적히고, 배치는 계속 돈다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(
            id="greetings",
            name="인사",
            cases=[a_case(runs_per_case=2, passes_needed=1)],
        )
    )
    service = a_service(
        specs, datasets, batches, model=RaisesOnceThenSays("반갑습니다")
    )

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    attempts = batch.results[0].attempts
    assert attempts[0].passed is False
    assert attempts[0].output_text == ""
    assert attempts[1].passed is True
    assert batch.results[0].passed is True  # passes_needed 1을 둘째 시도가 채운다


def test_an_attempt_that_pauses_at_a_gate_fails_and_the_batch_carries_on(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B6: 게이트에서 멈춘 시도는 불통과로 적히고, 배치는 계속 돈다(게이트 지원은 비범위)."""
    spec = a_greeter_spec(
        [a_node("writer"), a_node("gate", "control.human_gate")],
        [an_edge("writer-gate", "writer", "gate")],
    )
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(id="greetings", name="인사", cases=[a_case()]),
    )
    service = a_service(specs, datasets, batches)

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    attempt = batch.results[0].attempts[0]
    assert attempt.passed is False
    assert attempt.output_text == ""


def test_an_empty_output_text_is_always_unpassed(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """빈 output_text가 저절로 불통과가 되는 결합을 한 줄로 못박는다.

    B5/B6에서 실패·게이트 정지 시 output_text=""만 만들고 따로 분기하지 않는 이유다 —
    EvalCase.expected_phrases는 min_length=1이라, 빈 문자열은 그 어떤 기대 문구도 담을 수
    없다(엔진 쪽 증명은 packages/engine/tests/test_evaluation_expected_phrases.py).
    """
    assert judge_expected_phrases(a_case().expected_phrases, "").passed is False


def test_a_failed_attempt_carries_the_words_the_answer_was_missing(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """C7: 실패한 회차의 까닭은 서버가 적어 저장한다 — 화면이 다시 세지 않는다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(
            id="greetings",
            name="인사",
            cases=[a_case(expected_phrases=["반갑습니다", "감사합니다"])],
        )
    )
    service = a_service(specs, datasets, batches, model=Says("반갑습니다"))

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    attempt = batch.results[0].attempts[0]
    assert attempt.passed is False
    assert attempt.missing_phrases == ["감사합니다"]


def test_a_passing_attempt_carries_no_missing_words(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """C8: 통과한 회차에는 빠진 말이 없다 — 통과 옆에 까닭을 붙이지 않는다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, batches, model=Says("반갑습니다"))

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    attempt = batch.results[0].attempts[0]
    assert attempt.passed is True
    assert attempt.missing_phrases == []


def test_an_attempt_that_never_ran_misses_every_expected_phrase(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """C7: 모델이 어그러져 답이 없던 회차도 침묵하지 않는다 — 기대한 말 전부가 근거다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(
            id="greetings",
            name="인사",
            cases=[a_case(expected_phrases=["반갑습니다", "감사합니다"])],
        )
    )
    service = a_service(
        specs, datasets, batches, model=RaisesOnceThenSays("반갑습니다")
    )

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    assert batch.results[0].attempts[0].missing_phrases == ["반갑습니다", "감사합니다"]


def test_a_stale_spec_revision_is_refused(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B7: 오래된 revision으로는 배치를 시작하지 않는다 — RunService와 같은 규칙."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, batches)

    outcome = service.start("greetings", SPEC_ID, "sha256:" + "9" * 64)

    assert isinstance(outcome, EvalBatchRefused)
    assert outcome.reason == "stale_revision"
    assert batches.list_for_dataset("greetings") == []


def test_an_empty_dataset_completes_immediately_with_no_results(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B11: 케이스가 없는 데이터셋은 곧장 완결되고, results는 빈 리스트다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="empty", name="빈 것", cases=[]))
    service = a_service(specs, datasets, batches)

    outcome = service.start("empty", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)

    assert service.view(outcome.batch_id) == batches.get(outcome.batch_id)
    assert batches.get(outcome.batch_id).results == []


def test_a_completed_batch_keeps_dataset_spec_started_at_and_case_order(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B12: 완결된 EvalBatch는 dataset_id·spec_revision·started_at·케이스 순서를 지킨다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(
        EvalDataset(
            id="greetings",
            name="인사",
            cases=[a_case(id="first"), a_case(id="second")],
        )
    )
    service = a_service(specs, datasets, batches)

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    batch = batches.get(outcome.batch_id)

    assert batch.dataset_id == "greetings"
    assert batch.spec_id == SPEC_ID
    assert batch.spec_revision == spec.revision
    assert batch.started_at == STARTED_AT
    assert [result.case_id for result in batch.results] == ["first", "second"]


def test_a_batch_still_running_is_reported_as_running(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """B9의 서비스 쪽 절반: 완결 전 조회는 running 표시, 완결 후는 저장된 EvalBatch다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    taken: list = []
    service = EvalBatchService(
        datasets=datasets,
        specs=specs,
        batches=batches,
        model=Says("반갑습니다"),
        clock=Ticking(),
        new_run_id=counting_ids("run"),
        new_batch_id=counting_ids("batch"),
        worker=taken.append,  # 맡기면 받아만 둔다 — 아직 아무 일도 일어나지 않는다.
    )

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)

    assert isinstance(service.view(outcome.batch_id), EvalBatchRunning)

    taken[0]()  # 이제야 맡은 일을 한다 — 배경이 끝난 뒤의 모습을 본다.

    completed = service.view(outcome.batch_id)
    assert completed == batches.get(outcome.batch_id)


def test_a_batch_that_breaks_while_saving_is_reported_as_failed(
    specs: InMemorySpecStore, datasets: InMemoryEvalDatasetStore
):
    """major 1: 배경에서 저장이 어그러지면 in-flight에서 내려가고, 조회가 실패를 말한다.

    RunService의 규율과 같다(run_service.py의 `_gives_up`) — 배경에서 죽은 배치가
    영영 running인 척하면, 기다리는 사람은 아무 소식도 듣지 못한다.
    """
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, BreaksWhileSaving())

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)

    view = service.view(outcome.batch_id)

    assert isinstance(view, EvalBatchFailed)


def test_the_last_spoken_text_excludes_router_envelopes(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """major 3: 리뷰가 재현한 그래프 — writer → router(llm.router) → 2갈래 core.output.

    판정 대상은 writer가 낸 말이어야 한다 — router가 답한 길 선택 봉투(JSON)가 아니다.
    엔진의 `spoken_llm_texts`를 재사용해야 통과하는 시험이다.
    """
    spec = a_greeter_spec(
        [
            a_node("writer"),
            a_node("triage", "llm.router"),
            a_node("out-a", "core.output"),
            a_node("out-b", "core.output"),
        ],
        [
            an_edge("writer-triage", "writer", "triage", target_port="draft"),
            an_edge(
                "triage-a",
                "triage",
                "out-a",
                source_port="route",
                target_port="note",
                expression="route == 'a'",
            ),
            an_edge(
                "triage-b",
                "triage",
                "out-b",
                source_port="route",
                target_port="note",
                expression="route == 'b'",
            ),
        ],
    )
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, batches, model=routes_after_writing)

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    batch = batches.get(outcome.batch_id)

    attempt = batch.results[0].attempts[0]
    assert attempt.output_text == "반갑습니다"
    assert attempt.passed is True


def test_the_later_spoken_node_wins_when_two_nodes_speak(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """판정 대상 선택 규칙: 말하는 노드 둘 중, 나중에 말한 쪽의 말이 output_text가 된다.

    첫 노드는 기대 문구를 말하지 않고, 둘째(나중) 노드가 말한다 — `spoken[-1]`이 아니라
    `spoken[0]`을 골랐다면 이 시험은 불통과로 깨진다.
    """
    spec = a_greeter_spec(
        [a_node("first"), a_node("second")],
        [an_edge("first-second", "first", "second")],
    )
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))

    def says_by_node(ask: ModelAsk) -> ModelSaid:
        text = "반갑습니다" if ask.node.id == "second" else "안녕하세요"
        return ModelSaid(input_tokens=1, output_tokens=1, text=text)

    service = a_service(specs, datasets, batches, model=says_by_node)

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    batch = batches.get(outcome.batch_id)

    attempt = batch.results[0].attempts[0]
    assert attempt.output_text == "반갑습니다"
    assert attempt.passed is True


def test_listing_batches_for_a_dataset_returns_summaries_with_has_more(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """minor 6: 배치 목록은 output_text 전문을 담지 않는 요약이고, /specs처럼 has_more를 센다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, batches)
    first = service.start("greetings", SPEC_ID, spec.revision)
    second = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(first, EvalBatchStarted)
    assert isinstance(second, EvalBatchStarted)

    listing = service.list_for_dataset("greetings", limit=1)

    assert len(listing.batches) == 1
    assert listing.has_more is True
    assert listing.batches[0].case_count == 1
    assert listing.batches[0].passed_count == 1


def test_listing_batches_exactly_at_the_limit_has_no_more(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """has_more 경계: /specs와 같은 결 — 정확히 limit개면 잘린 게 없으니 has_more는 False다."""
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    service = a_service(specs, datasets, batches)
    service.start("greetings", SPEC_ID, spec.revision)
    service.start("greetings", SPEC_ID, spec.revision)

    listing = service.list_for_dataset("greetings", limit=2)

    assert len(listing.batches) == 2
    assert listing.has_more is False


def test_listing_batches_for_an_unknown_dataset_is_none(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    service = a_service(specs, datasets, batches)

    assert service.list_for_dataset("nobody-here") is None


def test_an_evaluator_handed_in_from_outside_is_the_one_that_runs(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """C2: 새 판정기는 이 파일들을 고치지 않고 실행에 편입된다(OCP).

    아래 판정기는 시험 파일에서만 만들어졌는데도, 넘겨주기만 하면 배치가 그것으로 돈다 —
    저장된 결과의 이름·판·판정·근거가 전부 그 판정기의 것이다.
    """
    spec = a_greeter_spec([a_node("writer")])
    specs.append(spec, created_at=STARTED_AT)
    datasets.save(EvalDataset(id="greetings", name="인사", cases=[a_case()]))
    stand_in = a_stand_in_evaluator(EVALUATOR_NAME)
    service = a_service(
        specs,
        datasets,
        batches,
        model=Says("반갑습니다"),  # expected_phrases였다면 통과했을 답이다
        evaluators={EVALUATOR_NAME: stand_in},
    )

    outcome = service.start("greetings", SPEC_ID, spec.revision)
    assert isinstance(outcome, EvalBatchStarted)
    batch = batches.get(outcome.batch_id)

    assert batch is not None
    result = batch.results[0]
    assert result.evaluator_version == "v9"
    assert result.passed is False
    assert result.attempts[0].passed is False
    assert result.attempts[0].missing_phrases == ["이 판정기가 적은 까닭"]


def test_a_service_without_the_evaluator_it_needs_says_so_at_once(
    specs: InMemorySpecStore,
    datasets: InMemoryEvalDatasetStore,
    batches: InMemoryEvalBatchStore,
):
    """C2: 고를 판정기가 없으면 배치를 돌려 놓고 뒤늦게 어그러지지 않는다 — 만드는 그 자리에서 말한다."""
    with pytest.raises(ValueError, match=EVALUATOR_NAME):
        a_service(specs, datasets, batches, evaluators={})
