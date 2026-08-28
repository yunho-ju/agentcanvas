"""판정 사다리 — 싼 층부터 딛고, 아래층이 놓친 말만 윗층에 올려 보낸다.

규칙은 하나다: 어느 층이 남김없이 건지면 그 회차는 거기서 통과로 끝나고(윗층은 부르지
않는다), 못 건진 말만 다음 층으로 간다. 마지막까지 남은 말이 그 회차의 근거이고,
마지막으로 판정한 층의 이름이 judged_by다. 윗층이 하나도 없으면 사다리는 조용히
짧아진다 — 0층의 판정이 그대로 결론이다.

층을 더하거나 순서를 바꾸는 데 이 파일을 고치지 않는다(OCP): 층 목록은 밖에서 받는다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .evaluator import Evaluator


@dataclass(frozen=True)
class LadderVerdict:
    """사다리를 다 딛고 난 결론 — 통과했는가, 끝내 못 건진 말, 그리고 누가 판정했는가."""

    passed: bool
    missing_phrases: list[str]
    judged_by: str


def judged_up_the_ladder(
    ground: Evaluator,
    higher: Sequence[Evaluator],
    expected_phrases: Sequence[str],
    output_text: str,
) -> LadderVerdict:
    """0층부터 차례로 딛는다 — 0층은 반드시 있고(사다리의 밑동), 윗층은 없을 수도 있다."""
    judged_by = ground.definition.name
    judgement = ground.judge(expected_phrases, output_text)
    for rung in higher:
        if judgement.passed:
            break
        judged_by = rung.definition.name
        judgement = rung.judge(judgement.missing_phrases, output_text)
    return LadderVerdict(
        passed=judgement.passed,
        missing_phrases=list(judgement.missing_phrases),
        judged_by=judged_by,
    )


__all__ = ["LadderVerdict", "judged_up_the_ladder"]
