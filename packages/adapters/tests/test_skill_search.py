"""무엇을 잘하게 할까를 물으면 시작 skill과 바깥 목록에서 찾아 주는 자리 (SK-4).

바깥을 부르는 일은 주입한다: 무엇을 읽어 내는가는 순수한 규칙이고, 실제로 부르는 일만
`runs_with_npx`가 한다. 저쪽 사정은 예외가 아니라 값으로 돌아온다 — 찾기는 결코 던지지 않는다.
"""

from __future__ import annotations

from agentcanvas_adapters.skill_search import (
    CACHE_FOR_S,
    CACHE_HOW_MANY,
    NPX_TIMEOUT_S,
    DidNotRun,
    FindRequest,
    Ran,
    RemoteUnavailable,
    SkillHit,
    hits_in_find_output,
    npx_skills_find,
    remembering,
    search_skills,
)
from agentcanvas_contracts.starter_skills import starter_skills

#: 진짜 `npx skills find pdf`가 뱉은 글 그대로 (2026-09-03 실측) — 색 코드까지 그대로 둔다.
FIND_OUTPUT = (
    "\n"
    "\x1b[38;5;102mInstall with\x1b[0m npx skills add <owner/repo@skill>\n"
    "\n"
    "\x1b[38;5;145manthropics/skills@pdf\x1b[0m \x1b[36m189.7K installs\x1b[0m\n"
    "\x1b[38;5;102m└ https://skills.sh/anthropics/skills/pdf\x1b[0m\n"
    "\n"
    "\x1b[38;5;145mopenai/skills@pdf\x1b[0m \x1b[36m12K installs\x1b[0m\n"
    "\x1b[38;5;102m└ https://skills.sh/openai/skills/pdf\x1b[0m\n"
    "\n"
    "\x1b[38;5;145mclaude-office-skills/skills@pdf ocr extraction\x1b[0m "
    "\x1b[36m4.9K installs\x1b[0m\n"
    "\x1b[38;5;102m└ https://skills.sh/claude-office-skills/skills/pdf-ocr-extraction"
    "\x1b[0m\n"
)


def runs(answer: Ran | DidNotRun, asked: list[FindRequest] | None = None):
    """언제나 같은 답을 주는 명령 — 무엇을 물었는지만 적어 둔다."""

    def running(request: FindRequest) -> Ran | DidNotRun:
        if asked is not None:
            asked.append(request)
        return answer

    return running


def test_the_find_output_is_read_into_hits():
    hits = hits_in_find_output(FIND_OUTPUT)

    assert [hit.name for hit in hits] == ["pdf", "pdf", "pdf ocr extraction"]
    assert hits[0] == SkillHit(
        name="pdf",
        description=None,
        origin="remote",
        url="https://skills.sh/anthropics/skills/pdf",
        installs=189_700,
        owner_repo="anthropics/skills",
        ref=None,
    )
    # 천·백만 자리를 접은 수는 펴서 센다 — 화면은 숫자 하나만 보인다.
    assert [hit.installs for hit in hits] == [189_700, 12_000, 4_900]
    assert hits[2].owner_repo == "claude-office-skills/skills"


def test_a_line_without_a_place_to_go_is_not_a_hit():
    """갈 자리가 없는 줄은 결과가 아니다 — 누르면 본문을 읽어 와야 하기 때문이다."""
    text = "acme/kit@lonely 5K installs\nacme/kit@paired 4K installs\n└ https://skills.sh/acme/kit/paired\n"

    assert [hit.name for hit in hits_in_find_output(text)] == ["paired"]


def test_no_results_is_an_empty_list_not_a_failure():
    assert hits_in_find_output('\x1b[38;5;102mNo skills found for "zzz"\x1b[0m\n') == []


def test_a_command_that_is_not_there_is_a_remote_we_could_not_reach():
    got = npx_skills_find("pdf", runs=runs(DidNotRun(reason="no_npx")))

    assert isinstance(got, RemoteUnavailable)
    assert got.reason == "no_npx"


def test_waiting_too_long_is_a_remote_we_could_not_reach():
    asked: list[FindRequest] = []

    got = npx_skills_find("pdf", runs=runs(DidNotRun(reason="timeout"), asked))

    assert isinstance(got, RemoteUnavailable)
    assert asked == [FindRequest(query="pdf", timeout_s=NPX_TIMEOUT_S)]


def test_a_command_that_ends_badly_is_a_remote_we_could_not_reach():
    got = npx_skills_find("pdf", runs=runs(Ran(exit_code=1, text=FIND_OUTPUT)))

    assert isinstance(got, RemoteUnavailable)
    assert got.reason == "refused"


def test_starter_skills_come_first_and_the_remote_follows():
    remote = SkillHit(
        name="plain-writing",
        description=None,
        origin="remote",
        url="https://skills.sh/acme/kit/plain-writing",
        installs=1_000,
        owner_repo="acme/kit",
        ref=None,
    )

    answer = search_skills(
        "plain",
        starters=starter_skills().values(),
        remote=lambda _query: [remote],
    )

    assert answer.remote_reached is True
    assert [hit.origin for hit in answer.hits] == ["starter", "remote"]
    assert answer.hits[0].name == "plain-answer"
    assert answer.hits[0].ref == "skill://plain-answer@1"


def test_starters_that_share_no_words_are_not_found():
    answer = search_skills(
        "zzzz", starters=starter_skills().values(), remote=lambda _query: []
    )

    assert answer.hits == []


def test_a_remote_we_cannot_reach_still_answers_with_the_starters():
    answer = search_skills(
        "plain",
        starters=starter_skills().values(),
        remote=lambda _query: RemoteUnavailable(reason="timeout"),
    )

    assert answer.remote_reached is False
    assert [hit.origin for hit in answer.hits] == ["starter"]


def test_with_no_remote_at_all_the_outside_is_not_reached():
    answer = search_skills("plain answer", starters=(), remote=None)

    assert answer.remote_reached is False
    assert answer.hits == []


def test_the_same_question_within_ten_minutes_is_not_asked_again():
    asked: list[str] = []
    now = [0.0]

    def counting(query: str) -> list[SkillHit]:
        asked.append(query)
        return []

    remembers = remembering(counting, clock=lambda: now[0])
    remembers("pdf")
    now[0] = CACHE_FOR_S - 1
    remembers("pdf")
    remembers("docx")

    assert asked == ["pdf", "docx"]


def test_a_question_asked_again_after_ten_minutes_reaches_out_again():
    asked: list[str] = []
    now = [0.0]
    remembers = remembering(
        lambda query: (asked.append(query), [])[1], clock=lambda: now[0]
    )

    remembers("pdf")
    now[0] = CACHE_FOR_S + 1
    remembers("pdf")

    assert asked == ["pdf", "pdf"]


def test_a_remote_we_could_not_reach_is_not_remembered_as_an_answer():
    """닿지 못한 것은 답이 아니다 — 10분 동안 빈손을 되풀이하지 않는다."""
    asked: list[str] = []

    def failing(query: str) -> RemoteUnavailable:
        asked.append(query)
        return RemoteUnavailable(reason="timeout")

    remembers = remembering(failing, clock=lambda: 0.0)
    remembers("pdf")
    remembers("pdf")

    assert asked == ["pdf", "pdf"]


def test_a_command_we_are_not_allowed_to_run_is_a_remote_we_could_not_reach():
    """부를 수 없는 사정은 여러 가지다 — 어느 것도 찾기 밖으로 던져지지 않는다."""

    def refusing(_request: FindRequest) -> Ran:
        raise PermissionError("not allowed to run npx")

    got = npx_skills_find("pdf", runs=refusing)

    assert isinstance(got, RemoteUnavailable)


def test_nothing_a_command_can_do_escapes_the_search():
    def exploding(_query: str) -> list[SkillHit]:
        raise OSError("the machine said no")

    answer = search_skills("plain", starters=(), remote=exploding)

    assert answer.remote_reached is False
    assert answer.hits == []


def counting(asked: list[str]):
    def remote(query: str) -> list[SkillHit]:
        asked.append(query)
        return []

    return remote


def test_the_same_question_written_differently_is_the_same_question():
    """앞뒤 빈칸·큰 글자·겹친 빈칸은 다른 물음이 아니다 — 바깥을 두 번 부르지 않는다."""
    asked: list[str] = []
    remembers = remembering(counting(asked), clock=lambda: 0.0)

    remembers("Plain Answer")
    remembers("  plain   answer ")

    assert asked == ["Plain Answer"]


def test_the_memory_does_not_grow_without_end():
    asked: list[str] = []
    remembers = remembering(counting(asked), clock=lambda: 0.0, how_many=2)

    remembers("one")
    remembers("two")
    remembers("three")
    # 가장 오래 전에 물은 것부터 자리를 내어 준다.
    remembers("two")
    remembers("one")

    assert asked == ["one", "two", "three", "one"]


def test_the_memory_the_server_runs_with_is_bounded_too():
    """자리 수는 시험에서만 정하는 것이 아니다 — 서버가 들고 도는 기억도 한계를 지닌다."""
    asked: list[str] = []
    remembers = remembering(counting(asked), clock=lambda: 0.0)

    for index in range(CACHE_HOW_MANY + 1):
        remembers(f"question {index}")
    remembers("question 0")

    assert asked[-1] == "question 0"
