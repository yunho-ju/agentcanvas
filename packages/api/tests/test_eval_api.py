"""배치 평가 문들 — 데이터셋을 CRUD하고, 배치를 열고, 그 지금 모습을 듣는다.

실행 이름과 시계는 주입한다: 시험은 언제나 같은 답을 본다.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_adapters.anthropic_model import ANTHROPIC_API_KEY_REF
from agentcanvas_adapters.llm_judge import JUDGE_PROMPT_REF
from agentcanvas_adapters.scripted import ScriptedEntailment
from agentcanvas_adapters.secrets import env_name
from agentcanvas_api import app as app_module
from agentcanvas_api.app import LOCAL_MODEL_ENV, create_app
from agentcanvas_api.eval_service import JUDGE_WAS_NOT_THERE
from agentcanvas_api.memory_eval_batch_store import InMemoryEvalBatchStore
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import Work, Worker
from agentcanvas_engine.model_call import ModelSaid
from fastapi.testclient import TestClient

STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
SPEC_ID = "clinical-assistant"
EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def right_here(work: Work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


def spec_payload(**overrides) -> dict:
    import json

    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return {**raw, **overrides}


def a_dataset_payload(**overrides) -> dict:
    base = {
        "id": "greetings",
        "name": "인사 데이터셋",
        "cases": [
            {
                "id": "greeting",
                "title": "반갑다는 인사",
                "input": {"question": "hi"},
                "expected_phrases": ["hello"],
                "runs_per_case": 1,
                "passes_needed": 1,
            }
        ],
    }
    return {**base, **overrides}


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


@pytest.fixture
def worker() -> Worker:
    return right_here


@pytest.fixture
def client(worker: Worker) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=worker,
        )
    )


def test_a_saved_dataset_round_trips_through_get(client: TestClient):
    posted = client.post("/eval/datasets", json=a_dataset_payload())
    assert posted.status_code == 201

    got = client.get("/eval/datasets/greetings")

    assert got.status_code == 200
    assert got.json()["name"] == "인사 데이터셋"


def test_a_dataset_shows_up_in_the_list(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    listed = client.get("/eval/datasets")

    assert listed.status_code == 200
    assert [entry["id"] for entry in listed.json()] == ["greetings"]
    assert listed.json()[0]["case_count"] == 1


def test_put_updates_a_saved_dataset(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    updated = client.put(
        "/eval/datasets/greetings", json=a_dataset_payload(name="고친 이름")
    )

    assert updated.status_code == 200
    assert client.get("/eval/datasets/greetings").json()["name"] == "고친 이름"


def test_delete_removes_a_saved_dataset(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    deleted = client.delete("/eval/datasets/greetings")

    assert deleted.status_code == 204
    assert client.get("/eval/datasets/greetings").status_code == 404


def test_reading_an_unknown_dataset_is_404(client: TestClient):
    """B8: 없는 데이터셋."""
    assert client.get("/eval/datasets/nobody-here").status_code == 404


def test_starting_a_batch_on_an_unknown_dataset_is_404(client: TestClient):
    """B8: 없는 데이터셋으로 배치를 시작할 수 없다."""
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]

    response = client.post(
        "/eval/datasets/nobody-here/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )

    assert response.status_code == 404


def test_starting_a_batch_on_an_unknown_spec_is_404(client: TestClient):
    """B8: 없는 그래프로 배치를 시작할 수 없다."""
    client.post("/eval/datasets", json=a_dataset_payload())

    response = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": "nobody-here",
            "spec_revision": "sha256:" + "0" * 64,
        },
    )

    assert response.status_code == 404


def test_a_batch_not_yet_finished_reads_as_running_then_reads_as_completed():
    """B9: 완결 전 GET batch는 running 표시, 완결 후 GET은 저장된 EvalBatch다."""
    later = LaterWhenAsked()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=later,
        )
    )
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )
    assert started.status_code == 202
    batch_id = started.json()["batch_id"]

    running = client.get(f"/eval/batches/{batch_id}")
    assert running.status_code == 200
    assert running.json()["status"] == "running"
    assert running.json()["batch"] is None

    later.get_on_with_it()

    completed = client.get(f"/eval/batches/{batch_id}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["batch"]["id"] == batch_id
    assert completed.json()["batch"]["dataset_id"] == "greetings"


def test_reading_an_unknown_batch_is_404(client: TestClient):
    assert client.get("/eval/batches/nobody-here").status_code == 404


def test_listing_batches_for_a_dataset_is_a_summary_with_has_more(client: TestClient):
    """minor 6: 목록은 output_text 전문이 없는 요약이고, has_more를 함께 센다."""
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )
    batch_id = started.json()["batch_id"]

    listed = client.get("/eval/datasets/greetings/batches")

    assert listed.status_code == 200
    body = listed.json()
    assert [batch["id"] for batch in body["batches"]] == [batch_id]
    assert body["has_more"] is False
    assert "results" not in body["batches"][0]


def test_listing_batches_for_an_unknown_dataset_is_404(client: TestClient):
    assert client.get("/eval/datasets/nobody-here/batches").status_code == 404


class BreaksWhileSaving:
    """배경에서 배치를 저장하다 어그러지는 저장소 — 조회가 running인 척 영영 기다리게 하지 않는다."""

    def save(self, batch) -> None:
        raise RuntimeError("the disk went away")

    def get(self, batch_id: str):
        return None

    def list_for_dataset(self, dataset_id: str, limit: int | None = None) -> list:
        return []


def test_a_batch_that_breaks_while_saving_reads_as_failed():
    """major 1: 배경에서 죽은 배치는 running인 척하지 않고, 조회가 실패를 말한다."""
    later = LaterWhenAsked()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=BreaksWhileSaving(),
            clock=lambda: STARTED_AT,
            worker=later,
        )
    )
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={"spec_id": SPEC_ID, "spec_revision": spec["revision"]},
    )
    batch_id = started.json()["batch_id"]

    later.get_on_with_it()

    failed = client.get(f"/eval/batches/{batch_id}")
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert failed.json()["message"]


def a_client_with(asks_entailment=None, model=None) -> TestClient:
    """뜻 검사 백엔드를 밖에서 건네받는 서버 — 시험은 진짜 모델을 싣지 않는다."""
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=right_here,
            asks_entailment=asks_entailment,
            **({} if model is None else {"model": model}),
        )
    )


def one_attempt_of_a_batch(client: TestClient, **asked) -> dict:
    """스펙·데이터셋을 올리고 배치 하나를 끝까지 돌려 그 회차를 돌려준다."""
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())
    started = client.post(
        "/eval/datasets/greetings/batches",
        json={"spec_id": SPEC_ID, "spec_revision": spec["revision"], **asked},
    )
    assert started.status_code == 202
    read = client.get(f"/eval/batches/{started.json()['batch_id']}")
    assert read.json()["status"] == "completed"
    return read.json()["batch"]["results"][0]["attempts"][0]


def test_a_meaning_backend_handed_to_the_server_is_the_one_the_ladder_asks():
    """수정 3: 함의 백엔드는 주입 구멍으로 들어온다 — 서버가 스스로 모델을 싣지 않는다."""
    asks = ScriptedEntailment([True])

    attempt = one_attempt_of_a_batch(a_client_with(asks))

    assert len(asks.asked) == 1
    assert attempt["judged_by"] == "nli_entailment"
    assert attempt["passed"] is True


def test_a_server_that_was_handed_nothing_never_loads_a_model_by_itself(monkeypatch):
    """서버를 만드는 것만으로 3GB짜리 모델을 싣지 않는다 — 시험 26곳이 이 문을 지난다."""

    def must_not_be_called(*args, **kwargs):
        raise AssertionError("create_app loaded a meaning model on its own")

    monkeypatch.setattr(app_module, "local_entailment", must_not_be_called)

    attempt = one_attempt_of_a_batch(a_client_with())

    assert attempt["judged_by"] == "expected_phrases"


def test_the_server_entry_point_is_the_one_that_loads_the_meaning_model(monkeypatch):
    """실제로 띄우는 자리에서만 싣는다 — Dockerfile이 부르는 그 자리다."""
    asks = ScriptedEntailment([])
    handed: dict[str, object] = {}
    monkeypatch.setattr(app_module, "local_entailment", lambda: asks)
    monkeypatch.setattr(
        app_module, "create_app", lambda **made: handed.update(made) or "an app"
    )

    assert app_module.serves() == "an app"
    assert handed == {"asks_entailment": asks}


class SaysOneThingAndJudges:
    """실행에는 짧게 답하고, 심판으로 불릴 때만 판정을 말하는 모델 — 부른 자리로 갈린다."""

    def __init__(self, said: str = "안녕하세요", contained: bool = True) -> None:
        self._said = said
        self._contained = contained
        #: 심판으로 불린 물음들 — 몇 번 불렸는지는 시험이 직접 센다.
        self.judged: list[str] = []

    def __call__(self, ask):
        if ask.prompt_ref == JUDGE_PROMPT_REF:
            self.judged.append(ask.instruction or "")
            return ModelSaid(
                input_tokens=1,
                output_tokens=1,
                text=json.dumps({"contained": self._contained}),
            )
        if ask.ways:
            return ModelSaid(
                input_tokens=1,
                output_tokens=1,
                way=ask.ways[0],
                text=json.dumps({"way": ask.ways[0]}),
            )
        return ModelSaid(input_tokens=1, output_tokens=1, text=self._said)


def test_a_batch_that_did_not_ask_for_the_judge_never_calls_it():
    """C3: 값이 드는 층은 기본으로 꺼져 있다 — 청하지 않은 배치의 판정은 예전 그대로다."""
    model = SaysOneThingAndJudges()

    attempt = one_attempt_of_a_batch(a_client_with(model=model))

    assert model.judged == []
    assert attempt["judged_by"] == "expected_phrases"
    assert attempt["passed"] is False


def test_a_batch_that_asked_for_the_judge_is_judged_by_it():
    """C6: 켜서 청하면 0층이 못 건진 말만 심판에게 가고, 담겼다면 그 회차는 구제된다."""
    model = SaysOneThingAndJudges()

    attempt = one_attempt_of_a_batch(a_client_with(model=model), use_judge=True)

    assert [asked for asked in model.judged if "hello" in asked]
    assert attempt["judged_by"] == "llm_judge"
    assert attempt["passed"] is True


def test_asking_for_a_judge_this_server_cannot_stand_leaves_the_verdict_alone():
    """C10: 물을 곳이 없는 서버는 심판을 세우지 않는다 — 청해도 싼 층의 판정이 그대로다."""
    attempt = one_attempt_of_a_batch(a_client_with(), use_judge=True)

    assert attempt["judged_by"] == "expected_phrases"


def test_a_batch_request_does_not_take_words_it_does_not_know():
    """오타를 조용히 삼키면 켠 줄 아는 사람 밑에서 심판 없이 돈다."""
    client = a_client_with()
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    asked = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
            "useJudge": True,
        },
    )

    assert asked.status_code == 422


def a_server_that_picks_its_own_model(monkeypatch, env: dict, model) -> TestClient:
    """서버가 스스로 모델을 고르는 배선 — 무엇을 고를지는 env가, 무엇이 답할지는 대역이 정한다.

    진짜 provider에 나가지 않게 무엇이 답하는지만 대역으로 바꾼다: 심판을 세울지 말지는
    여전히 env(카탈로그·열쇠)를 보고 정해야 한다 — 그 판단이 이 시험의 대상이다.
    """
    monkeypatch.setattr(app_module.os, "environ", env)
    monkeypatch.setattr(app_module, "asks_the_model_in", lambda _env: model)
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=right_here,
        )
    )


def test_a_judge_does_not_stand_where_its_own_model_cannot_be_asked(
    monkeypatch, caplog
):
    """다른 문이 열렸다고 심판이 서지 않는다 — 심판이 부를 그 이름이 열려야 심판이다.

    내 컴퓨터의 모델만 세운 서버에서 심판이 서면, 모든 질의가 열쇠 없는 문 앞에서 balk하고
    화면에는 '심판이 보고 못 건졌다'는 거짓이 남는다.
    """
    model = SaysOneThingAndJudges()

    with caplog.at_level(logging.WARNING, logger="agentcanvas_api.eval_service"):
        attempt = one_attempt_of_a_batch(
            a_server_that_picks_its_own_model(
                monkeypatch, {LOCAL_MODEL_ENV: "qwen3"}, model
            ),
            use_judge=True,
        )

    assert model.judged == []
    assert attempt["judged_by"] == "expected_phrases"
    assert JUDGE_WAS_NOT_THERE in caplog.text


def test_a_judge_stands_where_its_own_model_can_be_asked(monkeypatch):
    """심판이 부를 이름의 문이 열린 서버에서는 심판이 선다."""
    model = SaysOneThingAndJudges()

    attempt = one_attempt_of_a_batch(
        a_server_that_picks_its_own_model(
            monkeypatch,
            {env_name(ANTHROPIC_API_KEY_REF): "sk-a-key"},
            model,
        ),
        use_judge=True,
    )

    assert model.judged
    assert attempt["judged_by"] == "llm_judge"


def layers_standing_in(client: TestClient) -> dict[str, bool]:
    """이 서버가 내려주는 '지금 선 판정 층' — 이름을 그대로 서는지 여부에 맺어 읽는다."""
    answer = client.get("/eval/evaluators")

    assert answer.status_code == 200
    return {layer["name"]: layer["standing"] for layer in answer.json()}


def test_the_wording_check_stands_on_every_server():
    """EVAL_HONESTY 1: 0층은 아무것도 설치하지 않아도 선다 — 화면은 그 사실을 그대로 읽는다."""
    assert layers_standing_in(a_client_with())["expected_phrases"] is True


def test_the_meaning_check_stands_only_where_a_meaning_backend_was_handed_in():
    """EVAL_HONESTY 2: 같은 시험이 서버마다 다르게 판정되는 까닭이 화면에 닿는다."""
    assert layers_standing_in(a_client_with())["nli_entailment"] is False
    assert (
        layers_standing_in(a_client_with(ScriptedEntailment([])))["nli_entailment"]
        is True
    )


def test_the_judge_stands_only_where_its_own_model_can_be_asked(monkeypatch):
    """EVAL_HONESTY 3: 부를 수 없는 심판을 설 수 있다고 말하지 않는다 — 사다리와 같은 판단이다."""
    only_my_computer = a_server_that_picks_its_own_model(
        monkeypatch, {LOCAL_MODEL_ENV: "qwen3"}, SaysOneThingAndJudges()
    )
    assert layers_standing_in(only_my_computer)["llm_judge"] is False

    with_a_key = a_server_that_picks_its_own_model(
        monkeypatch,
        {env_name(ANTHROPIC_API_KEY_REF): "sk-a-key"},
        SaysOneThingAndJudges(),
    )
    assert layers_standing_in(with_a_key)["llm_judge"] is True
