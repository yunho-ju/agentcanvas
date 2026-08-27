"""실행이 실패한 갈래를 서버와 화면이 같은 목록으로 알고 있는가.

서버가 낼 수 있는 갈래는 두 곳에서 나온다: 모델에게 물어보지 못한 까닭(ModelTrouble)과,
실행이 뜻밖의 일로 어그러진 자리(RUN_WENT_WRONG). 스튜디오는 그 갈래마다 다른 말을 하므로,
목록이 어긋나면 사람은 새 실패를 뭉뚱그린 한 문장으로만 듣게 된다.

손으로 두 곳에 적어 두지 않는다: 여기서 파이썬 쪽 원천을 모아, 스튜디오가 들고 있는
FAILURE_REASONS 목록과 견준다.
"""

import re
from pathlib import Path
from typing import get_args

from agentcanvas_api.run_service import RUN_WENT_WRONG
from agentcanvas_engine.model_call import ModelTrouble

#: 스튜디오가 실패 갈래를 적어 둔 자리.
EVENT_WORDS = Path(__file__).resolve().parents[3] / "apps/studio/src/run/eventWords.ts"


def reasons_the_server_can_send() -> set[str]:
    """서버가 run.failed에 실을 수 있는 갈래 전부 — 각자의 원천에서 모은다."""
    return set(get_args(ModelTrouble)) | {str(RUN_WENT_WRONG["reason"])}


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
