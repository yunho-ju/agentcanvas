"""주소 하나에서 표준 SKILL.md 원문을 가져오는 자리 (SK-3).

부수효과(그물)는 주입한다: 어디를 부를 수 있고 어디를 찾아보는지는 순수한 규칙이고,
실제로 부르는 일만 `gets_with_httpx`가 한다. 저쪽 사정은 예외가 아니라 값으로 돌려준다 —
부르는 자리(API)가 그것을 사람이 읽을 한 줄로 옮긴다.

읽은 글을 skill로 만드는 일은 여기서 하지 않는다: 표준 파서(`skill_markdown`)의 몫이다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlparse

# 우리가 부르는 자리 — 이 밖으로는 한 번도 나가지 않는다 (SSRF 표면을 좁힌다).
ALLOWED_HOSTS = ("github.com", "raw.githubusercontent.com", "skills.sh")

#: 저장소에게 "네 skill을 어디에 두었니"를 묻는 자리 — **우리가 짓는 주소**에만 쓴다.
#: 사람이 적어 준 주소는 여기로 갈 수 없다(ALLOWED_HOSTS는 그대로다).
LOOKUP_HOST = "api.github.com"

RAW_HOST = "raw.githubusercontent.com"
SKILLS_SH = "skills.sh"
GITHUB = "github.com"

#: 기다리는 시간과 실어 오는 크기의 한계 — 넘으면 값으로 말한다.
TIMEOUT_S = 5.0
MAX_BYTES = 256 * 1024

#: 저장소가 가진 자리 목록의 한계 — 이보다 길면 읽지 않고 "여기 없다"로 답한다.
MAX_TREE_BYTES = 2 * 1024 * 1024

#: 그물이 가져오다 만 사정 -> 화면이 아는 코드 (그 밖의 사정은 "여기 없다"로 다음 자리를 본다).
STOPPED_BY = {
    "timeout": "skill.fetch.timeout",
    "toolarge": "skill.fetch.toolarge",
}

#: SKILL.md 파일 이름 — 저장소 목록에서 이 이름의 자리를 고른다.
SKILL_FILE = "SKILL.md"

#: 저장소가 skill을 두는 흔한 자리들 — 앞에서부터 차례로 찾아본다.
SKILL_PATHS = ("skills/{skill}/SKILL.md", "{skill}/SKILL.md", "SKILL.md")
DEFAULT_BRANCH = "main"

_SKILLS_SH = re.compile(r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/(?P<skill>[^/]+)/?$")
_GITHUB_BLOB = re.compile(r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/blob/(?P<rest>.+)$")
_GITHUB_TREE = re.compile(
    r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)/tree/(?P<branch>[^/]+)(?:/(?P<path>.*?))?/?$"
)
_GITHUB_REPO = re.compile(r"^/(?P<owner>[^/]+)/(?P<repo>[^/]+)")


@dataclass(frozen=True)
class FetchRequest:
    """바깥으로 나가는 부탁 하나 — 전송이 그대로 실어 보낼 수 있는 모양.

    얼마나 실어 올 것인가는 **부르는 쪽**이 정한다: 파일 하나와 저장소의 자리 목록은
    크기가 다른 물건이라, 전송이 한 값을 박아 두면 목록을 영영 읽지 못한다.
    """

    url: str
    timeout_s: float
    max_bytes: int = MAX_BYTES


@dataclass(frozen=True)
class Fetched:
    status_code: int
    text: str


@dataclass(frozen=True)
class FetchFailed:
    """그물이 답을 가져오지 못한 사정 — 예외가 아니라 값이다."""

    reason: str
    message: str


Gets = Callable[[FetchRequest], Fetched | FetchFailed]


@dataclass(frozen=True)
class SkillFetched:
    """가져온 원문과, 실제로 그것이 있던 자리."""

    text: str
    url: str


@dataclass(frozen=True)
class SkillFetchFailed:
    """가져오지 못한 까닭 — 화면이 쉬운 말로 옮길 코드 하나다."""

    code: str


def _raw(owner: str, repo: str, path: str, branch: str = DEFAULT_BRANCH) -> str:
    return f"https://{RAW_HOST}/{owner}/{repo}/{branch}/{path}"


def _first_time(paths: list[str]) -> list[str]:
    """같은 자리를 두 번 묻지 않는다 — 차례는 그대로 둔다."""
    kept: list[str] = []
    for path in paths:
        if path not in kept:
            kept.append(path)
    return kept


@dataclass(frozen=True)
class SkillPlace:
    """어느 저장소의 어느 skill을 찾고 있는가 — 판을 적지 않은 주소면 branch는 없다."""

    owner: str
    repo: str
    name: str
    branch: str | None


def _inside_paths(folder: str, name: str) -> list[str]:
    """폴더 하나 아래에서 skill이 있을 만한 자리들 — 안, 흔한 자리, 그리고 뿌리."""
    return _first_time(
        [
            *([f"{folder}/SKILL.md"] if folder else []),
            f"skills/{name}/SKILL.md",
            "SKILL.md",
        ]
    )


def _github_candidates(path: str, branch: str) -> list[str]:
    """github.com 주소 하나가 가리키는 SKILL.md가 있을 만한 자리들."""
    # 파일 주소는 그 파일의 원문 자리 하나로 옮겨 부른다.
    blob = _GITHUB_BLOB.match(path)
    if blob:
        return [f"https://{RAW_HOST}/{blob['owner']}/{blob['repo']}/{blob['rest']}"]

    tree = _GITHUB_TREE.match(path)
    if tree:
        folder = (tree["path"] or "").strip("/")
        name = folder.rsplit("/", 1)[-1] if folder else tree["repo"]
        return [
            _raw(tree["owner"], tree["repo"], one, tree["branch"])
            for one in _inside_paths(folder, name)
        ]

    # 저장소 주소(와 우리가 읽지 못하는 그 밖의 github 페이지)는 그 저장소의 흔한 자리를 본다.
    repo = _GITHUB_REPO.match(path)
    if not repo:
        return []
    return [
        _raw(repo["owner"], repo["repo"], one, branch)
        for one in _inside_paths("", repo["repo"])
    ]


def raw_candidates(url: str, branch: str = DEFAULT_BRANCH) -> list[str]:
    """이 주소가 가리키는 SKILL.md가 있을 만한 자리들 — 부를 수 없는 주소면 없다.

    주소가 판(branch)을 적어 두었으면 그것을 따르고, 적지 않았으면 건네받은 판을 본다.
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host not in ALLOWED_HOSTS:
        return []
    if host == RAW_HOST:
        return [url]
    if host == GITHUB:
        return _github_candidates(parsed.path, branch)
    found = _SKILLS_SH.match(parsed.path)
    if not found:
        return []
    return [
        _raw(found["owner"], found["repo"], path.format(skill=found["skill"]), branch)
        for path in SKILL_PATHS
    ]


def skill_place(url: str) -> SkillPlace | None:
    """이 주소가 말하는 저장소와 skill 이름 — 저장소에게 물어볼 수 있는 주소일 때만.

    파일 하나를 콕 집은 주소(raw·blob)는 여기 오지 않는다: 거기 없으면 없는 것이다.
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host == SKILLS_SH and (found := _SKILLS_SH.match(parsed.path)):
        return SkillPlace(found["owner"], found["repo"], found["skill"], None)
    if host != GITHUB:
        return None
    if tree := _GITHUB_TREE.match(parsed.path):
        folder = (tree["path"] or "").strip("/")
        name = folder.rsplit("/", 1)[-1] if folder else tree["repo"]
        return SkillPlace(tree["owner"], tree["repo"], name, tree["branch"])
    if _GITHUB_BLOB.match(parsed.path):
        return None
    if repo := _GITHUB_REPO.match(parsed.path):
        return SkillPlace(repo["owner"], repo["repo"], repo["repo"], None)
    return None


def _read(
    url: str, *, gets: Gets, timeout_s: float, cap: int
) -> str | SkillFetchFailed | None:
    """한 자리에서 글 하나 — 거기 없으면 None(다음 자리를 본다), 그 밖의 사정은 값이다.

    너무 자주 물어 저쪽이 쉬라고 하면(403) 그것은 "여기 없다"가 아니다 — 그대로 말한다.
    """
    answer = gets(FetchRequest(url=url, timeout_s=timeout_s, max_bytes=cap))
    if isinstance(answer, FetchFailed):
        # 제때 답하지 않은 것과 너무 큰 것은 "여기 없다"와 다른 일이다 — 그대로 말한다.
        stopped = STOPPED_BY.get(answer.reason)
        return SkillFetchFailed(code=stopped) if stopped else None
    # 쉬라는 말은 저장소에게 물었을 때의 것이다 — 원문 자리의 403은 "여기 없다"로 지나간다.
    if answer.status_code == 403 and urlparse(url).hostname == LOOKUP_HOST:
        return SkillFetchFailed(code="skill.fetch.ratelimited")
    if answer.status_code != 200:
        return None
    if len(answer.text.encode("utf-8")) > cap:
        return SkillFetchFailed(code="skill.fetch.toolarge")
    return answer.text


def _first_of(
    candidates: list[str], *, gets: Gets, timeout_s: float
) -> SkillFetched | SkillFetchFailed | None:
    """흔한 자리들을 차례로 — 어디에도 없으면 None(더 물어볼 자리가 남았다는 뜻)."""
    for candidate in candidates:
        got = _read(candidate, gets=gets, timeout_s=timeout_s, cap=MAX_BYTES)
        if isinstance(got, SkillFetchFailed):
            return got
        if got is not None:
            return SkillFetched(text=got, url=candidate)
    return None


def _answered(
    url: str, *, gets: Gets, timeout_s: float
) -> dict[str, object] | SkillFetchFailed | None:
    """저장소에게 물어본 답 한 벌 — 읽지 못한 답은 "여기 없다"와 같이 다룬다."""
    got = _read(url, gets=gets, timeout_s=timeout_s, cap=MAX_TREE_BYTES)
    if got is None:
        return None
    if isinstance(got, SkillFetchFailed):
        # 너무 길어 다 읽지 못한 목록은 "여기 없다"이다 — 반쯤 읽고 고른 자리는 답이 아니다.
        return (
            SkillFetchFailed(code="skill.fetch.notfound")
            if got.code == "skill.fetch.toolarge"
            else got
        )
    try:
        read = json.loads(got)
    except json.JSONDecodeError:
        return None
    return read if isinstance(read, dict) else None


def _place_in_tree(tree: dict[str, object], name: str) -> str | None:
    """목록에서 이 skill이 사는 자리 — 이름이 **자리 하나와 같은** 것만 고른다.

    여럿이면 가장 얕은 자리다: 저장소의 대표 자리를 곁가지보다 앞에 둔다.
    """
    if tree.get("truncated") is True:
        return None
    entries = tree.get("tree")
    if not isinstance(entries, list):
        return None
    found = [
        str(entry["path"])
        for entry in entries
        if isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and str(entry["path"]).split("/")[-2:] == [name, SKILL_FILE]
    ]
    if not found:
        return None
    return min(found, key=lambda path: (path.count("/"), len(path), path))


def _looked_up(
    url: str, place: SkillPlace, *, gets: Gets, timeout_s: float
) -> SkillFetched | SkillFetchFailed:
    """흔한 자리에 없을 때 저장소에게 직접 물어본다 — 어느 판인지, 어디에 두었는지.

    남의 문은 아껴 두드린다: 흔한 자리에서 찾지 못했을 때에만 여기까지 온다.
    """
    told = _answered(
        f"https://{LOOKUP_HOST}/repos/{place.owner}/{place.repo}",
        gets=gets,
        timeout_s=timeout_s,
    )
    if isinstance(told, SkillFetchFailed):
        return told
    if told is None:
        return SkillFetchFailed(code="skill.fetch.notfound")
    said = told.get("default_branch")
    branch = place.branch or (
        said if isinstance(said, str) and said else DEFAULT_BRANCH
    )

    # 저장소가 제 판을 다르게 부르면 흔한 자리를 그 판에서 한 번 더 본다.
    if branch != DEFAULT_BRANCH and place.branch is None:
        got = _first_of(raw_candidates(url, branch), gets=gets, timeout_s=timeout_s)
        if got is not None:
            return got

    tree = _answered(
        f"https://{LOOKUP_HOST}/repos/{place.owner}/{place.repo}"
        f"/git/trees/{branch}?recursive=1",
        gets=gets,
        timeout_s=timeout_s,
    )
    if isinstance(tree, SkillFetchFailed):
        return tree
    path = _place_in_tree(tree, place.name) if tree is not None else None
    if path is None:
        return SkillFetchFailed(code="skill.fetch.notfound")
    got = _first_of(
        [_raw(place.owner, place.repo, path, branch)], gets=gets, timeout_s=timeout_s
    )
    return got if got is not None else SkillFetchFailed(code="skill.fetch.notfound")


def fetch_skill_markdown(
    url: str,
    *,
    gets: Gets,
    timeout_s: float = TIMEOUT_S,
) -> SkillFetched | SkillFetchFailed:
    """주소 하나가 가리키는 SKILL.md 원문 — 못 가져오면 던지지 않고 까닭을 돌려준다.

    흔한 자리(`SKILL_PATHS`)를 먼저 보고, 없으면 저장소에게 어디에 두었는지 물어본다:
    저장소마다 skill을 두는 자리가 달라서(`plugins/x/skills/<name>/SKILL.md` 같은 자리)
    흔한 자리만 보면 실제로 있는 skill을 없다고 말하게 된다.
    """
    candidates = raw_candidates(url)
    if not candidates:
        return SkillFetchFailed(code="skill.fetch.host")

    got = _first_of(candidates, gets=gets, timeout_s=timeout_s)
    if got is not None:
        return got
    place = skill_place(url)
    if place is None:
        return SkillFetchFailed(code="skill.fetch.notfound")
    return _looked_up(url, place, gets=gets, timeout_s=timeout_s)


def gets_with_httpx(request: FetchRequest) -> Fetched | FetchFailed:
    """진짜 그물을 타는 전송 — 적어 둔 시간만 기다리고, 옮겨 간 자리는 따라가지 않는다.

    크기 한계는 다 받아 본 뒤가 아니라 **받는 중에** 건다: 부탁에 적힌 한계를 넘는 순간
    그만 받는다 (파일 하나와 저장소의 자리 목록은 서로 다른 한계를 지고 온다).
    """
    import httpx

    try:
        with httpx.stream(
            "GET",
            request.url,
            timeout=request.timeout_s,
            # 옮겨 간 자리를 따라가지 않는다: 허용한 자리만 부른다.
            follow_redirects=False,
        ) as answered:
            carried = bytearray()
            for piece in answered.iter_bytes():
                carried.extend(piece)
                if len(carried) > request.max_bytes:
                    return FetchFailed(
                        reason="toolarge",
                        message=f"the answer is bigger than {request.max_bytes} bytes",
                    )
            return Fetched(
                status_code=answered.status_code,
                text=carried.decode(answered.encoding or "utf-8", errors="replace"),
            )
    except httpx.TimeoutException as waited:
        return FetchFailed(
            reason="timeout", message=str(waited) or "the call timed out"
        )
    except (httpx.HTTPError, httpx.InvalidURL) as trouble:
        return FetchFailed(reason="unreachable", message=str(trouble))


__all__ = [
    "ALLOWED_HOSTS",
    "LOOKUP_HOST",
    "MAX_BYTES",
    "MAX_TREE_BYTES",
    "SKILL_PATHS",
    "STOPPED_BY",
    "TIMEOUT_S",
    "FetchFailed",
    "FetchRequest",
    "Fetched",
    "Gets",
    "SkillFetchFailed",
    "SkillFetched",
    "SkillPlace",
    "fetch_skill_markdown",
    "gets_with_httpx",
    "raw_candidates",
    "skill_place",
]
