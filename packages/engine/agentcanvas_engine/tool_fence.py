"""도구가 돌려준 것이 모델에게 회신되기까지 — 감싸고, 다듬고, 너무 길면 자른다.

이 파일은 **도구 결과가 모델 앞에 놓이는 모양**이 바뀔 때만 바뀐다. 결과 처리(digest 등)는
이미 어댑터에서 끝났고, 여기서 하는 일은 그 다음의 최소 방어다: 결과가 지시문 행세를 하지
못하게 구분자로 감싸고, 제어문자를 걷어 내고, 한 물음이 감당할 만큼만 싣는다.

완전한 방어가 아니다(설계 D9): 감싸는 글자 자체를 흉내 내는 결과를 막지는 못한다.
"""

from __future__ import annotations

import json
import unicodedata

from .model_call import ToolReply

#: 한 도구 결과가 모델에게 실릴 수 있는 최대 글자 수 — 넘어서면 잘렸다고 말한다.
MAX_TOOL_RESULT_CHARS = 8000

#: 잘렸다는 표시 — 조용히 자르지 않는다.
CUT_MARK = "…(cut)"

#: 결과가 시작하고 끝나는 자리 — 여기부터 저기까지는 도구가 한 말이지 지시가 아니다.
OPENS = "<<tool_result name={name}>>"
CLOSES = "<</tool_result>>"

#: 줄바꿈과 탭은 글의 모양이라 남긴다 — 나머지 제어문자는 뜻이 없다.
KEPT_CONTROLS = frozenset({"\n", "\t"})

#: 사람이 그 호출을 멈춰 세웠을 때 모델이 듣는 말.
DECLINED = "the person declined this call"

#: 부탁은 나갔는데 답을 못 본 호출 — 다시 부르지 않고 이렇게 회신한다 (설계 §8).
NEVER_ANSWERED = "no answer was ever seen for this call"


def tool_result_fence(
    text: str, name: str, max_chars: int = MAX_TOOL_RESULT_CHARS
) -> str:
    """도구가 돌려준 글을 모델에게 넣을 수 있는 한 덩어리로 만든다.

    다듬고(제어문자 제거) → 자르고(상한) → 감싼다. 자르는 자리를 세는 것은 다듬은 뒤의
    글자다: 보이지 않는 글자가 실을 수 있는 양을 갉아먹지 않는다.
    """
    plain = "".join(
        letter
        for letter in text
        if letter in KEPT_CONTROLS or unicodedata.category(letter) != "Cc"
    )
    said = plain if len(plain) <= max_chars else plain[:max_chars] + CUT_MARK
    return f"{OPENS.format(name=name)}\n{said}\n{CLOSES}"


def as_written(result: object) -> str:
    """돌려받은 것을 모델이 읽을 한 모양으로 — 글이면 그 글, 아니면 기계가 주고받는 JSON."""
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False, sort_keys=True)


def reply_of(call_id: str, name: str, result: object) -> ToolReply:
    """도구가 돌려준 것을 그 호출의 회신으로 — 감싸는 일까지 마친 모습이다."""
    return ToolReply(
        call_id=call_id, name=name, content=tool_result_fence(as_written(result), name)
    )


def failed_reply(call_id: str, name: str, why: str) -> ToolReply:
    """부르지 못했거나 어그러진 호출의 회신 — 모델이 다른 길을 찾을 수 있게 까닭을 말한다."""
    return ToolReply(call_id=call_id, name=name, content=f"tool failed: {why}")


def declined_reply(call_id: str, name: str) -> ToolReply:
    """사람이 멈춰 세운 호출의 회신 — 실패가 아니라 사람의 뜻이라고 말한다."""
    return ToolReply(call_id=call_id, name=name, content=DECLINED)


__all__ = [
    "CUT_MARK",
    "DECLINED",
    "MAX_TOOL_RESULT_CHARS",
    "NEVER_ANSWERED",
    "as_written",
    "declined_reply",
    "failed_reply",
    "reply_of",
    "tool_result_fence",
]
