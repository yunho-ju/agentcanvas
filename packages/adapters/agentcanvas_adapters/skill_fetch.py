"""주소 하나에서 표준 SKILL.md 원문을 가져오는 자리 (SK-3).

부수효과(그물)는 주입한다: 어디를 부를 수 있고 어디를 찾아보는지는 순수한 규칙이고,
실제로 부르는 일만 `gets_with_httpx`가 한다. 저쪽 사정은 예외가 아니라 값으로 돌려준다 —
부르는 자리(API)가 그것을 사람이 읽을 한 줄로 옮긴다.

읽은 글을 skill로 만드는 일은 여기서 하지 않는다: 표준 파서(`skill_markdown`)의 몫이다.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlparse

# 우리가 부르는 자리 — 이 밖으로는 한 번도 나가지 않는다 (SSRF 표면을 좁힌다).
ALLOWED_HOSTS = ("github.com", "raw.githubusercontent.com", "skills.sh")

RAW_HOST = "raw.githubusercontent.com"
SKILLS_SH = "skills.sh"
GITHUB = "github.com"

#: 기다리는 시간과 실어 오는 크기의 한계 — 넘으면 값으로 말한다.
TIMEOUT_S = 5.0
MAX_BYTES = 256 * 1024

#: 그물이 가져오다 만 사정 -> 화면이 아는 코드 (그 밖의 사정은 "여기 없다"로 다음 자리를 본다).
STOPPED_BY = {
    "timeout": "skill.fetch.timeout",
    "toolarge": "skill.fetch.toolarge",
}

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
    """바깥으로 나가는 부탁 하나 — 전송이 그대로 실어 보낼 수 있는 모양."""

    url: str
    timeout_s: float


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


def _inside_paths(folder: str, name: str) -> list[str]:
    """폴더 하나 아래에서 skill이 있을 만한 자리들 — 안, 흔한 자리, 그리고 뿌리."""
    return _first_time(
        [
            *([f"{folder}/SKILL.md"] if folder else []),
            f"skills/{name}/SKILL.md",
            "SKILL.md",
        ]
    )


def _github_candidates(path: str) -> list[str]:
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
        _raw(repo["owner"], repo["repo"], one)
        for one in _inside_paths("", repo["repo"])
    ]


def raw_candidates(url: str) -> list[str]:
    """이 주소가 가리키는 SKILL.md가 있을 만한 자리들 — 부를 수 없는 주소면 없다."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if host not in ALLOWED_HOSTS:
        return []
    if host == RAW_HOST:
        return [url]
    if host == GITHUB:
        return _github_candidates(parsed.path)
    found = _SKILLS_SH.match(parsed.path)
    if not found:
        return []
    return [
        _raw(found["owner"], found["repo"], path.format(skill=found["skill"]))
        for path in SKILL_PATHS
    ]


def fetch_skill_markdown(
    url: str,
    *,
    gets: Gets,
    timeout_s: float = TIMEOUT_S,
) -> SkillFetched | SkillFetchFailed:
    """주소 하나가 가리키는 SKILL.md 원문 — 못 가져오면 던지지 않고 까닭을 돌려준다."""
    candidates = raw_candidates(url)
    if not candidates:
        return SkillFetchFailed(code="skill.fetch.host")

    for candidate in candidates:
        answer = gets(FetchRequest(url=candidate, timeout_s=timeout_s))
        if isinstance(answer, FetchFailed):
            # 제때 답하지 않은 것과 너무 큰 것은 "여기 없다"와 다른 일이다 — 그대로 말한다.
            stopped = STOPPED_BY.get(answer.reason)
            if stopped:
                return SkillFetchFailed(code=stopped)
            continue
        if answer.status_code != 200:
            continue
        if len(answer.text.encode("utf-8")) > MAX_BYTES:
            return SkillFetchFailed(code="skill.fetch.toolarge")
        return SkillFetched(text=answer.text, url=candidate)
    return SkillFetchFailed(code="skill.fetch.notfound")


def gets_with_httpx(request: FetchRequest) -> Fetched | FetchFailed:
    """진짜 그물을 타는 전송 — 적어 둔 시간만 기다리고, 옮겨 간 자리는 따라가지 않는다.

    크기 한계는 다 받아 본 뒤가 아니라 **받는 중에** 건다: 상한을 넘는 순간 그만 받는다.
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
                if len(carried) > MAX_BYTES:
                    return FetchFailed(
                        reason="toolarge",
                        message=f"the file is bigger than {MAX_BYTES} bytes",
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
    "MAX_BYTES",
    "SKILL_PATHS",
    "STOPPED_BY",
    "TIMEOUT_S",
    "FetchFailed",
    "FetchRequest",
    "Fetched",
    "Gets",
    "SkillFetchFailed",
    "SkillFetched",
    "fetch_skill_markdown",
    "gets_with_httpx",
    "raw_candidates",
]
