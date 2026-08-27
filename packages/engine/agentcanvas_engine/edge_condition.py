"""연결에 적힌 조건을 읽는 일 — CEL의 **부분집합**만 읽는 아주 좁은 평가기.

읽는 것은 두 모양뿐이다: `이름 == '값'`, `이름 != '값'` (따옴표는 작은따옴표·큰따옴표 둘 다).
그 밖의 표현식은 참도 거짓도 아닌 `Unsupported`로 답한다 — 못 읽은 조건을 조용히 통과시키거나
조용히 막으면, 사람이 적은 갈림길이 말없이 다른 뜻이 된다. 넓히는 것은 필요해질 때 한다.

순수 함수다: 예외를 던지지 않고, 밖의 무엇도 건드리지 않는다.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

#: 이 평가기가 읽는 단 하나의 모양 — 이름 하나, 견줌 하나, 따옴표에 싸인 값 하나.
_COMPARISON = re.compile(
    r"""^\s*
    (?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*
    (?P<comparison>==|!=)\s*
    (?:'(?P<single>[^']*)'|"(?P<double>[^"]*)")
    \s*$""",
    re.VERBOSE,
)


@dataclass(frozen=True)
class Unsupported:
    """이 평가기가 읽지 못한 표현식 — 답 대신 못 읽었다는 사실을 값으로 돌려준다."""

    expression: str


def evaluate(expression: str, state: Mapping[str, object]) -> bool | Unsupported:
    """조건이 지금 상태에서 참인가 — 읽지 못하는 표현식이면 `Unsupported`.

    상태가 모르는 이름에 대해서는 어느 견줌도 성립하지 않는다 (`==`도 `!=`도 거짓):
    값이 없는데 "다르다"를 참으로 삼으면, 아직 아무것도 정해지지 않은 자리가 갈래를 연다.
    """
    read = _COMPARISON.match(expression)
    if read is None:
        return Unsupported(expression)
    if read["name"] not in state:
        return False
    literal = read["single"] if read["single"] is not None else read["double"]
    same = state[read["name"]] == literal
    return same if read["comparison"] == "==" else not same


def named_value(expression: str, name: str) -> str | None:
    """이 조건이 그 이름에게 바라는 값 — `name == '값'`일 때의 `값`.

    갈림길이 내놓을 수 있는 길 이름을 조건에서 거꾸로 읽는 자리다.
    같지 않음(`!=`)이나 다른 이름의 조건은 갈 곳을 지목하지 않으므로 없음이다.
    """
    read = _COMPARISON.match(expression)
    if read is None or read["name"] != name or read["comparison"] != "==":
        return None
    return read["single"] if read["single"] is not None else read["double"]


__all__ = ["Unsupported", "evaluate", "named_value"]
