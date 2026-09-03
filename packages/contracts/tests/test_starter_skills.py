"""번들 시작 skill — 빈 문서 앞에서 바로 입어 볼 수 있는 도메인 중립 skill 세 벌."""

import importlib
from pathlib import Path

import pytest
from agentcanvas_contracts.skill_markdown import (
    BODY_LINE_LIMIT,
    parse_skill_markdown,
    render_skill_markdown,
)
from agentcanvas_contracts.starter_skills import (
    STARTER_SKILL_DIR,
    resolve_starter_skill,
    starter_skills,
)

# 꾸러미 뿌리는 같은 이름으로 함수를 내보낸다 — 모듈 자체는 sys.modules에서 가져온다.
starter_skills_module = importlib.import_module("agentcanvas_contracts.starter_skills")


def test_the_starter_skills_are_the_three_we_ship():
    assert sorted(starter_skills()) == [
        "skill://ask-before-acting@1",
        "skill://cite-sources@1",
        "skill://plain-answer@1",
    ]


@pytest.mark.parametrize("ref", sorted(starter_skills()))
def test_every_starter_skill_reads_without_a_single_complaint(ref):
    """우리가 싣는 skill이 우리 파서를 통과하지 못하면 표준을 지킨 것이 아니다."""
    path = STARTER_SKILL_DIR / starter_skills()[ref].name / "SKILL.md"
    assert parse_skill_markdown(path.read_text(encoding="utf-8")).issues == []


@pytest.mark.parametrize("ref", sorted(starter_skills()))
def test_every_starter_skill_lives_in_the_folder_it_is_named_after(ref):
    """표준 규칙 — 이름과 디렉터리 이름은 같다."""
    skill = starter_skills()[ref]
    assert (STARTER_SKILL_DIR / skill.name / "SKILL.md").exists()
    assert skill.ref == ref


@pytest.mark.parametrize("ref", sorted(starter_skills()))
def test_every_starter_skill_is_short_enough_to_read(ref):
    body = starter_skills()[ref].body
    assert len(body.rstrip("\n").split("\n")) <= 60 <= BODY_LINE_LIMIT


@pytest.mark.parametrize("ref", sorted(starter_skills()))
def test_every_starter_skill_says_its_korean_title(ref):
    """쉬운 말 원칙 — 고를 때 한국어 이름이 함께 보여야 한다."""
    assert starter_skills()[ref].metadata["ko-title"].strip() != ""


@pytest.mark.parametrize("ref", sorted(starter_skills()))
def test_every_starter_skill_writes_back_out_the_same(ref):
    skill = starter_skills()[ref]
    assert parse_skill_markdown(render_skill_markdown(skill)).skill == skill


def test_a_starter_skill_is_found_by_its_ref():
    assert resolve_starter_skill("skill://plain-answer@1") is not None


def test_an_unknown_ref_is_answered_with_nothing_instead_of_a_throw():
    assert resolve_starter_skill("skill://not-a-starter@1") is None


def test_the_folder_is_read_on_first_use_not_while_the_module_loads(monkeypatch):
    """기동만으로 디스크를 읽지 않는다 — 파일이 깨져 있어도 import는 성공한다."""

    def explode(*_args, **_kwargs):
        raise AssertionError("the skill folder was read while the module was loading")

    monkeypatch.setattr(Path, "read_text", explode)
    importlib.reload(starter_skills_module)


def test_a_starter_skill_that_stopped_being_standard_says_so_loudly(
    tmp_path, monkeypatch
):
    """깨진 파일은 조용히 빠지지 않는다 — 처음 쓰는 순간 이름을 대고 부서진다."""
    (tmp_path / "plain-answer").mkdir()
    (tmp_path / "plain-answer" / "SKILL.md").write_text(
        "---\nname: plain-answer\n---\n\nbody\n", encoding="utf-8"
    )
    monkeypatch.setattr(starter_skills_module, "STARTER_SKILL_DIR", tmp_path)
    monkeypatch.setattr(starter_skills_module, "STARTER_SKILL_NAMES", ("plain-answer",))

    starter_skills_module.starter_skills.cache_clear()
    try:
        with pytest.raises(ValueError) as exc:
            starter_skills_module.starter_skills()
        assert "plain-answer" in str(exc.value)
    finally:
        starter_skills_module.starter_skills.cache_clear()


def test_the_folder_is_read_once_and_the_same_answer_comes_back():
    assert starter_skills() is starter_skills()
