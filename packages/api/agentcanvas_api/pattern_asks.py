"""모델이 물어보자고 내민 것을 서버가 잘라 낸다 (설계 문서 D11).

모델은 고르기만 하고, 무엇이 사람에게 실제로 가는지는 서버가 정한다: 이 서버가 못 하는
모양, 두 번 든 같은 모양, 부탁에 없는 말을 근거로 든 것은 여기서 떨어진다. 남는 것이
없으면 되묻지 않는다 — 물을 것이 없는데 카드를 세우지 않는다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from agentcanvas_adapters.pattern_asker import ProposedAsk
from agentcanvas_contracts.architect_asks import PatternAsk
from agentcanvas_contracts.patterns import PatternDef

#: 한 판에 물을 수 있는 가장 많은 수 — 설문지가 되지 않게 하는 상한 (D11).
MOST_ASKS = 3


#: 모델이 인용한 조각에 둘러 보내는 부호 — 부탁의 글자가 아니라 인용의 표시다(실측).
QUOTE_MARKS = "\"'“”‘’「」『』"

#: 인용이라 부를 수 있는 가장 짧은 길이 — 한두 글자는 어느 부탁 안에나 들어 있다.
SHORTEST_QUOTE = 4


def _said_in(fragment: str, request: str) -> bool:
    """부탁 문장이 정말 그렇게 말했는가.

    띄어쓰기와 인용 부호는 세지 않지만(모델이 붙여 보내는 것들이다), 낱말 **속에서**
    시작하는 조각은 인용이 아니다: 'sand'가 'thousand' 안에 있다고 근거가 되지는 않는다.
    낱말 끝은 느슨하게 둔다 — 조사·어미까지 정확히 인용하기를 요구하지 않는다.
    """
    words = fragment.strip().strip(QUOTE_MARKS).split()
    if sum(len(word) for word in words) < SHORTEST_QUOTE:
        return False
    quoted = r"\s*".join(re.escape(word) for word in words)
    return re.search(rf"(?<!\w){quoted}", request, re.IGNORECASE) is not None


def asks_worth_making(
    proposed: Iterable[ProposedAsk],
    *,
    on_offer: Sequence[PatternDef],
    request: str,
) -> list[PatternAsk]:
    """사람에게 실제로 갈 물음들 — 카탈로그의 문장을 그대로 실어 최대 세 개까지."""
    catalog = {pattern.id: pattern for pattern in on_offer}
    asked: list[PatternAsk] = []
    for one in proposed:
        pattern = catalog.get(one.pattern_id)
        if pattern is None or not _said_in(one.why, request):
            continue
        if any(ask.pattern_id == pattern.id for ask in asked):
            continue
        asked.append(
            PatternAsk(
                pattern_id=pattern.id, question=pattern.question, cost=pattern.cost
            )
        )
        if len(asked) == MOST_ASKS:
            break
    return asked


__all__ = ["MOST_ASKS", "asks_worth_making"]
