"""주소 하나에서 SKILL.md 원문을 가져오는 자리 — 그물은 주입해 결정론으로 시험한다."""

from __future__ import annotations

from agentcanvas_adapters.skill_fetch import (
    ALLOWED_HOSTS,
    MAX_BYTES,
    TIMEOUT_S,
    Fetched,
    FetchFailed,
    FetchRequest,
    SkillFetched,
    SkillFetchFailed,
    fetch_skill_markdown,
    gets_with_httpx,
    raw_candidates,
)

SKILL = "---\nname: plain-answer\ndescription: use it\n---\n\nAnswer plainly.\n"


def answers(pages: dict[str, str], asked: list[str] | None = None):
    """적어 둔 자리에서만 200을 돌려주는 그물 — 나머지는 404다."""

    def gets(request: FetchRequest) -> Fetched | FetchFailed:
        if asked is not None:
            asked.append(request.url)
        text = pages.get(request.url)
        return Fetched(status_code=200, text=text) if text else Fetched(404, "")

    return gets


def test_a_raw_github_address_is_read_as_it_stands():
    url = "https://raw.githubusercontent.com/acme/kit/main/skills/plain/SKILL.md"

    got = fetch_skill_markdown(url, gets=answers({url: SKILL}))

    assert isinstance(got, SkillFetched)
    assert got.text == SKILL
    assert got.url == url


def test_a_skills_sh_address_is_tried_at_the_places_a_skill_lives():
    asked: list[str] = []
    found = "https://raw.githubusercontent.com/acme/kit/main/acme-skill/SKILL.md"

    got = fetch_skill_markdown(
        "https://skills.sh/acme/kit/acme-skill",
        gets=answers({found: SKILL}, asked),
    )

    assert isinstance(got, SkillFetched)
    assert got.url == found
    # 흔한 자리부터 차례로 — 찾은 다음에는 더 묻지 않는다.
    assert asked == [
        "https://raw.githubusercontent.com/acme/kit/main/skills/acme-skill/SKILL.md",
        found,
    ]


def test_a_github_page_address_is_read_from_the_raw_file():
    raw = "https://raw.githubusercontent.com/acme/kit/main/skills/plain/SKILL.md"

    got = fetch_skill_markdown(
        "https://github.com/acme/kit/blob/main/skills/plain/SKILL.md",
        gets=answers({raw: SKILL}),
    )

    assert isinstance(got, SkillFetched)
    assert got.url == raw


def test_an_address_we_do_not_call_never_reaches_the_net():
    asked: list[str] = []

    got = fetch_skill_markdown(
        "https://example.com/skills/plain/SKILL.md", gets=answers({}, asked)
    )

    assert got == SkillFetchFailed(code="skill.fetch.host")
    assert asked == []
    assert "example.com" not in ALLOWED_HOSTS


def test_nothing_at_any_of_the_places_is_said_plainly():
    got = fetch_skill_markdown("https://skills.sh/acme/kit/plain", gets=answers({}))

    assert got == SkillFetchFailed(code="skill.fetch.notfound")


def test_a_file_bigger_than_we_carry_is_refused():
    url = "https://raw.githubusercontent.com/acme/kit/main/SKILL.md"

    got = fetch_skill_markdown(url, gets=answers({url: "x" * (MAX_BYTES + 1)}))

    assert got == SkillFetchFailed(code="skill.fetch.toolarge")


def test_an_address_that_does_not_answer_in_time_says_so():
    def gets(_request: FetchRequest) -> FetchFailed:
        return FetchFailed(reason="timeout", message="the call timed out")

    got = fetch_skill_markdown(
        "https://raw.githubusercontent.com/acme/kit/main/SKILL.md", gets=gets
    )

    assert got == SkillFetchFailed(code="skill.fetch.timeout")


def test_a_github_folder_address_is_tried_at_the_places_a_skill_lives():
    asked: list[str] = []
    found = "https://raw.githubusercontent.com/acme/kit/main/skills/plain/SKILL.md"

    got = fetch_skill_markdown(
        "https://github.com/acme/kit/tree/main/skills/plain",
        gets=answers({found: SKILL}, asked),
    )

    assert isinstance(got, SkillFetched)
    assert asked[0] == found


def test_a_repository_address_looks_for_the_skill_at_its_root():
    root = "https://raw.githubusercontent.com/acme/kit/main/SKILL.md"

    got = fetch_skill_markdown(
        "https://github.com/acme/kit", gets=answers({root: SKILL})
    )

    assert isinstance(got, SkillFetched)
    assert got.url == root


def test_a_github_address_with_nothing_at_it_is_not_called_a_bad_address():
    """부를 수 있는 자리인데 없는 것과, 부를 수 없는 자리는 다른 일이다 (리뷰 지적 5)."""
    got = fetch_skill_markdown("https://github.com/acme/kit/pulls/7", gets=answers({}))

    assert got == SkillFetchFailed(code="skill.fetch.notfound")


def test_the_time_we_wait_is_carried_to_the_net():
    waited: list[float] = []

    def gets(request: FetchRequest) -> Fetched:
        waited.append(request.timeout_s)
        return Fetched(200, SKILL)

    fetch_skill_markdown(
        "https://raw.githubusercontent.com/acme/kit/main/SKILL.md", gets=gets
    )

    assert waited == [TIMEOUT_S]
    assert TIMEOUT_S == 5.0


def test_a_net_that_stopped_early_because_the_file_was_too_big_says_so():
    """크기 한계는 다 받아 본 뒤가 아니라 받는 중에 걸린다 — 전송이 그 사정을 값으로 말한다."""

    def gets(_request: FetchRequest) -> FetchFailed:
        return FetchFailed(reason="toolarge", message="stopped past the cap")

    got = fetch_skill_markdown(
        "https://raw.githubusercontent.com/acme/kit/main/SKILL.md", gets=gets
    )

    assert got == SkillFetchFailed(code="skill.fetch.toolarge")


def test_the_places_a_skills_sh_skill_may_live_are_written_in_one_place():
    assert raw_candidates("https://skills.sh/acme/kit/plain") == [
        "https://raw.githubusercontent.com/acme/kit/main/skills/plain/SKILL.md",
        "https://raw.githubusercontent.com/acme/kit/main/plain/SKILL.md",
        "https://raw.githubusercontent.com/acme/kit/main/SKILL.md",
    ]


class TestTheNetItActuallyRides:
    """진짜 전송의 약속 — 얼마나 기다리는지, 어디까지 받는지 (httpx는 흉내 낸다)."""

    def stream(self, monkeypatch, pieces: list[bytes], drawn: list[bytes]):
        import contextlib

        import httpx

        seen: dict[str, object] = {}

        class Answer:
            status_code = 200
            encoding = "utf-8"

            def iter_bytes(self):
                for piece in pieces:
                    drawn.append(piece)
                    yield piece

        @contextlib.contextmanager
        def stream(method: str, url: str, **options):
            seen["method"] = method
            seen["url"] = url
            seen.update(options)
            yield Answer()

        monkeypatch.setattr(httpx, "stream", stream)
        return seen

    def test_it_waits_only_as_long_as_we_said_and_follows_nobody(self, monkeypatch):
        seen = self.stream(monkeypatch, [SKILL.encode()], [])

        got = gets_with_httpx(FetchRequest(url="https://x/SKILL.md", timeout_s=5.0))

        assert got == Fetched(status_code=200, text=SKILL)
        assert seen["timeout"] == 5.0
        assert seen["follow_redirects"] is False

    def test_it_stops_drawing_the_file_once_it_passes_the_cap(self, monkeypatch):
        piece = b"x" * (MAX_BYTES // 2 + 1)
        drawn: list[bytes] = []
        self.stream(monkeypatch, [piece, piece, piece], drawn)

        got = gets_with_httpx(FetchRequest(url="https://x/SKILL.md", timeout_s=5.0))

        assert got.reason == "toolarge"
        # 다 받아 본 뒤에 재지 않는다 — 넘는 순간 그만둔다.
        assert len(drawn) == 2
