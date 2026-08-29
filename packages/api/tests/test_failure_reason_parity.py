"""실행이 실패한 갈래를 서버와 화면이 같은 목록으로 알고 있는가.

서버가 낼 수 있는 갈래는 세 곳에서 나온다: 모델에게 물어보지 못한 까닭(ModelTrouble),
도구를 부르지 못한 까닭 중 사람이 문서를 고쳐야 하는 것들(ToolTrouble에서 error 포트로
흐르는 것을 뺀 나머지), 그리고 실행이 뜻밖의 일로 어그러진 자리(RUN_WENT_WRONG).
스튜디오는 그 갈래마다 다른 말을 하므로, 목록이 어긋나면 사람은 새 실패를 뭉뚱그린 한
문장으로만 듣게 된다.

손으로 두 곳에 적어 두지 않는다: 여기서 파이썬 쪽 원천을 모아, 스튜디오가 들고 있는
FAILURE_REASONS 목록과 견준다.
"""

import re
from pathlib import Path
from typing import get_args

from agentcanvas_api.run_service import RUN_WENT_WRONG
from agentcanvas_engine.model_call import ModelTrouble
from agentcanvas_engine.tool_call import FLOWS_OUT_OF_THE_ERROR_PORT, ToolTrouble

#: 스튜디오가 실패 갈래를 적어 둔 자리.
EVENT_WORDS = Path(__file__).resolve().parents[3] / "apps/studio/src/run/eventWords.ts"


def reasons_the_server_can_send() -> set[str]:
    """서버가 run.failed에 실을 수 있는 갈래 전부 — 각자의 원천에서 모은다."""
    return (
        set(get_args(ModelTrouble))
        | (set(get_args(ToolTrouble)) - FLOWS_OUT_OF_THE_ERROR_PORT)
        | {str(RUN_WENT_WRONG["reason"])}
    )


def troubles_that_flow_on() -> set[str]:
    """실행을 끝내지 않고 도구가 낸 것으로 흐르는 갈래 — 목록은 이것을 tool.completed에서 말한다."""
    return set(FLOWS_OUT_OF_THE_ERROR_PORT)


def troubles_the_studio_knows() -> set[str]:
    """스튜디오가 도구의 어그러짐을 갈라 적어 둔 목록."""
    source = EVENT_WORDS.read_text(encoding="utf-8")
    listed = re.search(r"TOOL_TROUBLES = \[(.*?)\]", source, re.DOTALL)
    assert listed is not None, "the studio no longer lists TOOL_TROUBLES"
    return set(re.findall(r'"([^"]+)"', listed.group(1)))


def reasons_the_studio_knows() -> set[str]:
    """스튜디오의 FAILURE_REASONS 목록."""
    source = EVENT_WORDS.read_text(encoding="utf-8")
    listed = re.search(r"FAILURE_REASONS = \[(.*?)\]", source, re.DOTALL)
    assert listed is not None, "the studio no longer lists FAILURE_REASONS"
    return set(re.findall(r'"([^"]+)"', listed.group(1)))


def test_the_studio_knows_every_reason_the_server_can_send() -> None:
    assert reasons_the_studio_knows() == reasons_the_server_can_send()


def test_there_is_more_than_one_reason_to_tell_apart() -> None:
    assert len(reasons_the_server_can_send()) > 1


def test_the_studio_knows_every_way_a_tool_can_come_up_short() -> None:
    """도구가 어그러지는 갈래도 화면이 갈라 말한다 — 새 갈래가 조용히 뭉뚱그려지지 않는다."""
    assert troubles_the_studio_knows() == troubles_that_flow_on()


def test_the_studio_says_something_of_its_own_for_each_way_a_tool_falls_short() -> None:
    messages = (EVENT_WORDS.parent.parent / "i18n/messages.ts").read_text(
        encoding="utf-8"
    )
    missing = [
        trouble
        for trouble in troubles_that_flow_on()
        if f'"event.tool.trouble.{trouble}"' not in messages
    ]
    assert missing == []


def test_the_studio_says_something_of_its_own_for_each_reason() -> None:
    """갈래마다 사전에 문구가 있다 — 목록만 맞고 말이 없으면 사람에게는 없는 것과 같다."""
    messages = (EVENT_WORDS.parent.parent / "i18n/messages.ts").read_text(
        encoding="utf-8"
    )
    missing = [
        reason
        for reason in reasons_the_server_can_send()
        if f'"event.run.failed.{reason}"' not in messages
    ]
    assert missing == []
