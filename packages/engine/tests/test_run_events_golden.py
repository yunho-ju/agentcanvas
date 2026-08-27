"""커밋해 둔 예시 실행을 파이썬이 그대로 다시 만들어 내는가.

`examples/basic-agent/run_events.json`은 studio(TS)의 `fakeRun`이 만들어 낸 파일이다.
같은 spec·같은 실행 이름·같은 시작 시각을 주면 파이썬도 **똑같은 이벤트**를 내놓아야 한다 —
두 구현이 어긋나면 여기서 먼저 드러난다 (파일은 대조 기준이므로 고쳐 쓰지 않는다).

여기서 고정하는 것은 **모델 동일**(RunEvent로 읽은 뒤의 비교)이지 바이트 동일이 아니다.
계약상 같은 값의 직렬화 표현이 두 가지 다르다 — ① 파이썬은 run 레벨 이벤트에도
`"node_id": null`을 적고 TS는 키를 생략한다 ② timestamp가 파이썬은 마이크로초(.400000Z),
TS는 밀리초(.400Z)다. 둘 다 유효하므로 결함이 아니지만, 서버 SSE 페이로드와 클라이언트
`fakeRun` 산출물을 **문자열/스냅샷으로** 비교하면 어긋난다 (CP-6이 알아야 할 사실).
"""

from __future__ import annotations

import json
from datetime import datetime
from itertools import pairwise
from pathlib import Path

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import RunEvent
from agentcanvas_engine.fake_runtime import fake_run, resume_fake_run

EXAMPLE_DIR = Path(__file__).resolve().parents[3] / "examples/basic-agent"


def committed_events() -> list[RunEvent]:
    raw = json.loads((EXAMPLE_DIR / "run_events.json").read_text(encoding="utf-8"))
    return [RunEvent.model_validate(event) for event in raw]


def example_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((EXAMPLE_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def regenerated_events() -> list[RunEvent]:
    """기록된 실행은 사람이 승인해 끝까지 흐른 실행이다 — 실행 이름과 시작 시각은 파일에서 읽는다."""
    committed = committed_events()
    spec = example_spec()
    held = fake_run(spec, run_id=committed[0].run_id, started_at=committed[0].timestamp)
    return resume_fake_run(spec, held, ApprovalAnswer(approved=True))


def test_python_remakes_the_committed_example_run_event_for_event():
    assert regenerated_events() == committed_events()


def test_the_run_it_remakes_keeps_the_recorded_beat():
    times = [event.timestamp for event in regenerated_events()]
    steps = {later - earlier for earlier, later in pairwise(times)}

    assert steps == {times[1] - times[0]}
    assert isinstance(times[0], datetime)
