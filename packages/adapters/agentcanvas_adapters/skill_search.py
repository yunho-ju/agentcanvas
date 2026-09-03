"""무엇을 잘하게 하고 싶은지 물으면 skill을 찾아 주는 자리 (SK-4).

두 곳을 본다: 이 서버가 들고 있는 **시작 skill**과, 바깥의 **skills.sh 목록**이다.
바깥을 부르는 일은 주입한다 — 무엇을 읽어 내는가는 순수한 규칙(`hits_in_find_output`)이고,
실제로 명령을 부르는 일만 `runs_with_npx`가 한다.

바깥 사정은 예외가 아니라 값이다: 닿지 못했으면 `RemoteUnavailable`이 돌아오고, 찾기는
시작 skill만으로 답하며 **닿지 못했다는 사실을 함께** 말한다 (실패를 빈 결과로 둔갑시키지
않는다). 찾은 것을 문서에 들이는 일은 여기서 하지 않는다 — 본문을 읽어 오는 일은
`skill_fetch`의 몫이고, 넣는 것은 사람의 몫이다.
"""

from __future__ import annotations

import re
import subprocess
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from agentcanvas_contracts.skill_def import SkillDef
from agentcanvas_contracts.skill_similarity import SkillQuery, similar_skills

#: 바깥 목록을 기다리는 시간 — 넘으면 닿지 못한 것이다.
NPX_TIMEOUT_S = 8.0

#: 같은 물음을 다시 물어도 바깥을 다시 부르지 않는 동안 (초).
CACHE_FOR_S = 600.0

#: 기억해 두는 물음의 수 — 오래 도는 서버의 기억이 끝없이 자라지 않게 한다.
CACHE_HOW_MANY = 64

#: 접어 적은 설치 수를 펴는 자리수 — 새 글자가 생기면 여기 한 줄이다.
FOLDED = {"": 1, "K": 1_000, "M": 1_000_000}

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")

#: 찾은 skill 한 줄: `owner/repo@이름  12.3K installs`.
#: 이름에는 빈칸이 들 수 있다(실측 `claude-office-skills/skills@pdf ocr extraction`).
_HIT = re.compile(
    r"^(?P<owner_repo>\S+/\S+)@(?P<name>.+?)\s+"
    r"(?P<installs>[\d.]+)(?P<folded>[KM]?) installs\s*$"
)

#: 그 줄 바로 다음에 오는, 그 skill이 사는 자리.
_PLACE = re.compile(r"^└\s*(?P<url>https://skills\.sh/\S+)\s*$")


type HitOrigin = Literal["starter", "remote"]


@dataclass(frozen=True)
class SkillHit:
    """찾아낸 skill 하나 — 아직 본문은 읽지 않았다(누르면 그때 읽어 온다)."""

    name: str
    description: str | None
    origin: HitOrigin
    url: str | None = None
    installs: int | None = None
    owner_repo: str | None = None
    ref: str | None = None


@dataclass(frozen=True)
class RemoteUnavailable:
    """바깥 목록에 닿지 못한 까닭 — 예외가 아니라 값이다."""

    reason: str


@dataclass(frozen=True)
class SearchAnswer:
    """찾은 것들과, 바깥까지 닿았는가 — 닿지 못한 것은 결과 없음과 다른 일이다."""

    hits: list[SkillHit]
    remote_reached: bool


type RemoteSearch = Callable[[str], list[SkillHit] | RemoteUnavailable]


@dataclass(frozen=True)
class FindRequest:
    """바깥에 던지는 물음 하나 — 명령을 부르는 자리가 그대로 실어 보낼 수 있는 모양."""

    query: str
    timeout_s: float


@dataclass(frozen=True)
class Ran:
    exit_code: int
    text: str


@dataclass(frozen=True)
class DidNotRun:
    """명령이 답을 내놓지 못한 사정 — 없거나(no_npx), 너무 오래 걸렸거나(timeout)."""

    reason: str


type Runs = Callable[[FindRequest], Ran | DidNotRun]


def _installs(counted: str, folded: str) -> int:
    return int(float(counted) * FOLDED[folded])


def hits_in_find_output(text: str) -> list[SkillHit]:
    """`npx skills find`가 뱉은 글에서 찾은 skill들 — 색 코드는 셈에 들지 않는다.

    갈 자리(주소)가 적히지 않은 줄은 결과가 아니다: 누르면 본문을 읽어 와야 하는데,
    읽어 올 자리가 없는 이름은 사람에게 막다른 길이다.
    """
    lines = _ANSI.sub("", text).splitlines()
    hits: list[SkillHit] = []
    for line, following in pairwise(lines):
        found = _HIT.match(line.strip())
        place = _PLACE.match(following.strip())
        if not found or not place:
            continue
        hits.append(
            SkillHit(
                name=found["name"],
                description=None,
                origin="remote",
                url=place["url"],
                installs=_installs(found["installs"], found["folded"]),
                owner_repo=found["owner_repo"],
            )
        )
    return hits


def runs_with_npx(request: FindRequest) -> Ran | DidNotRun:
    """진짜 명령을 부르는 자리 — 적어 둔 시간만 기다리고, 무엇도 묻지 않는다.

    묻는 입(stdin)은 닫아 둔다: 서버 안에서 부르는 명령이 사람을 기다리며 서 있으면
    그것은 닿지 못한 것보다 나쁘다.
    """
    try:
        # 부르는 것은 고정된 명령 하나뿐이다 — 물음은 낱말 하나로 실려 껍데기를 거치지 않는다.
        finished = subprocess.run(
            ["npx", "skills", "find", request.query],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=request.timeout_s,
            check=False,
        )
    except FileNotFoundError:
        return DidNotRun(reason="no_npx")
    except subprocess.TimeoutExpired:
        return DidNotRun(reason="timeout")
    except (OSError, subprocess.SubprocessError) as trouble:
        # 부를 수 없는 사정은 여러 가지다(권한, 열린 파일 수…) — 전부 "닿지 못했다"이다.
        return DidNotRun(reason=type(trouble).__name__)
    return Ran(exit_code=finished.returncode, text=finished.stdout)


def npx_skills_find(
    query: str,
    *,
    runs: Runs = runs_with_npx,
    timeout_s: float = NPX_TIMEOUT_S,
) -> list[SkillHit] | RemoteUnavailable:
    """바깥 목록에 물어본다 — 닿지 못하면 던지지 않고 그 까닭을 돌려준다."""
    try:
        answer = runs(FindRequest(query=query, timeout_s=timeout_s))
    except (OSError, subprocess.SubprocessError) as trouble:
        return RemoteUnavailable(reason=type(trouble).__name__)
    if isinstance(answer, DidNotRun):
        return RemoteUnavailable(reason=answer.reason)
    if answer.exit_code != 0:
        return RemoteUnavailable(reason="refused")
    return hits_in_find_output(answer.text)


def the_same_question(query: str) -> str:
    """같은 물음을 같은 것으로 보는 자리 — 앞뒤 빈칸·큰 글자·겹친 빈칸은 다름이 아니다."""
    return " ".join(query.split()).casefold()


def remembering(
    remote: RemoteSearch,
    *,
    clock: Callable[[], float],
    for_seconds: float = CACHE_FOR_S,
    how_many: int = CACHE_HOW_MANY,
) -> RemoteSearch:
    """같은 물음을 짧은 사이에 되풀이하지 않게 감싼다 — 시계는 주입한다.

    닿지 못한 것은 기억하지 않는다: 잠깐의 사정을 10분 동안 사실로 굳히지 않는다.
    기억은 자라기만 하지 않는다: 지난 답은 만질 때 버리고, 자리가 차면 가장 오래
    전에 물은 것부터 내보낸다(오래 도는 서버가 물음마다 무거워지지 않게).
    """
    remembered: dict[str, tuple[float, list[SkillHit]]] = {}

    def asks(query: str) -> list[SkillHit] | RemoteUnavailable:
        now = clock()
        asked = the_same_question(query)
        held = remembered.pop(asked, None)
        if held is not None and now - held[0] <= for_seconds:
            remembered[asked] = held
            return held[1]
        answer = remote(query)
        if isinstance(answer, RemoteUnavailable):
            return answer
        remembered[asked] = (now, answer)
        while len(remembered) > how_many:
            remembered.pop(next(iter(remembered)))
        return answer

    return asks


def _starter_hits(query: str, starters: Iterable[SkillDef]) -> list[SkillHit]:
    """물음과 낱말이 겹치는 시작 skill들 — 고르는 규칙은 SK-5와 같은 한 곳이다.

    본문은 셈에 들지 않는다: 찾기는 이름과 쓰임새로 찾는다(긴 본문 하나가 다른 줄을
    밀어내지 않게).
    """
    by_name_and_what = [skill.model_copy(update={"body": ""}) for skill in starters]
    found = similar_skills(
        SkillQuery(description=query, body=""),
        by_name_and_what,
        how_many=len(by_name_and_what),
    )
    return [
        SkillHit(
            name=skill.name,
            description=skill.description,
            origin="starter",
            ref=skill.ref,
        )
        for skill in found
    ]


def search_skills(
    query: str,
    *,
    starters: Iterable[SkillDef],
    remote: RemoteSearch | None,
) -> SearchAnswer:
    """이 물음에 어울리는 skill들 — 가까운 것(시작 skill)부터, 그 다음이 바깥이다.

    바깥에 닿지 못해도 던지지 않는다: 있는 것만 돌려주고 닿지 못했다고 말한다.
    """
    hits = _starter_hits(query, starters)
    if remote is None:
        return SearchAnswer(hits=hits, remote_reached=False)
    try:
        found = remote(query)
    except Exception:  # noqa: BLE001 — 바깥의 어떤 사정도 찾기를 무너뜨리지 않는다
        # 닿지 못한 것은 값이다: 가까운 것(시작 skill)은 그대로 주고 닿지 못했다고 말한다.
        return SearchAnswer(hits=hits, remote_reached=False)
    if isinstance(found, RemoteUnavailable):
        return SearchAnswer(hits=hits, remote_reached=False)
    return SearchAnswer(hits=[*hits, *found], remote_reached=True)


__all__ = [
    "CACHE_FOR_S",
    "CACHE_HOW_MANY",
    "FOLDED",
    "NPX_TIMEOUT_S",
    "DidNotRun",
    "FindRequest",
    "HitOrigin",
    "Ran",
    "RemoteSearch",
    "RemoteUnavailable",
    "Runs",
    "SearchAnswer",
    "SkillHit",
    "hits_in_find_output",
    "npx_skills_find",
    "remembering",
    "runs_with_npx",
    "search_skills",
    "the_same_question",
]
