"""어느 곳에 묻든 같은 말·같은 규칙 — provider마다 다른 것은 어떻게 부르는가뿐이다.

모델이 무엇을 보는가(프롬프트), 무엇을 답으로 치는가(길 하나), 못 들었을 때 사람에게 무엇을
말하는가는 provider의 사정이 아니라 이 제품의 약속이다. 그래서 여기 한 벌만 산다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence

from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid, ToolCall
from agentcanvas_engine.skill_wear import SkillBrief

#: 무엇을 하는 자리인지 모델에게 먼저 일러 주는 말.
SPEAKING_SYSTEM = (
    "You are one step inside an agent graph. Answer the instruction using what has"
    " flowed into this step so far. Answer plainly and briefly."
)
PICKING_SYSTEM = (
    "You are the fork of an agent graph. Read what has flowed in so far and choose"
    " exactly one of the ways on offer. Choose the way that fits best."
)

#: 답을 듣지 못했을 때 사람에게 하는 말 — 남의 컴퓨터 속사정은 옮기지 않는다.
NO_ANSWER = "the model could not be reached, so this run stopped here"
DECLINED = "the model declined to answer this step, so this run stopped here"
WRONG_SHAPE = "the model did not answer in the shape this run asked for"
NOTHING_SAID = "the model answered with nothing at all, so this run stopped here"
CUT_SHORT = (
    "the model's answer was cut off before it finished, so this run stopped here"
)


def no_such_model(model_ref: str) -> ModelBalked:
    """아무도 세워 두지 않은 이름 앞에서는 그물에 나가지도 않는다."""
    return ModelBalked(
        reason="unknown_model",
        message=f"no model called {model_ref} is set up here — pick one from the list",
    )


def missing_key(key_ref: str) -> ModelBalked:
    """열쇠를 달라고 말한다 — 어떤 열쇠인지는 이름으로만 말하고, 값은 어디에도 없다."""
    return ModelBalked(
        reason="missing_secret",
        message=(
            "this step needs a key the server does not have —"
            f" put one in the server's secrets as {key_ref}"
        ),
    )


def cannot_take_tools(model_ref: str) -> ModelBalked:
    """도구를 못 받는 모델에 도구를 건넨 일 — 그물에 나가기 전에 이 까닭을 답한다."""
    return ModelBalked(
        reason="tools_unsupported",
        message=(
            f"the model {model_ref} cannot use tools —"
            " pick a model that can, or take the tools off this step"
        ),
    )


def trouble(message: str) -> ModelBalked:
    """저쪽 사정으로 답을 듣지 못한 일 — 까닭의 종류는 하나로 묶어 말한다."""
    return ModelBalked(reason="provider_error", message=message)


def what_flowed_in(state: Mapping[str, object]) -> str:
    """지금까지 흘러 들어온 것을 모델이 읽을 수 있게 적는다 — 아무것도 없으면 그렇다고 말한다."""
    if not state:
        return "nothing has flowed into this step yet."
    return "\n".join(f"- {name}: {value}" for name, value in sorted(state.items()))


def system_for(ask: ModelAsk) -> str:
    """이 물음이 판단인지 말하기인지 — 고를 길이 주어졌는가로 갈린다."""
    return PICKING_SYSTEM if ask.ways else SPEAKING_SYSTEM


#: 입은 skill이 지시문 뒤에 붙는 절의 첫 줄.
SKILLS_HEADING = "skills you follow:"


def _skill_lines(skills: Sequence[SkillBrief]) -> list[str]:
    """입은 skill이 모델의 글에 실리는 모습 — 입은 것이 없으면 절 자체가 없다(빈 절은 소음이다).

    본문이 실리지 못한 skill도 이름과 설명은 말한다: 무엇을 따르기로 했는지는 그대로 남는다.
    """
    if not skills:
        return []
    written = [SKILLS_HEADING]
    for skill in skills:
        written.append(f"## {skill.name} — {skill.description}")
        if skill.body is not None:
            written.append(skill.body)
    return written


def instruction(ask: ModelAsk) -> str:
    """모델이 읽을 지시문 — 어느 노드가, 무슨 지시로, 무엇을 보고 있는가.

    사람이 직접 적은 말이 있으면 그것이 지시다. 없으면 이름표(prompt_ref)라도 보낸다 —
    지어낸 이름이 대개 뜻을 담고 있어, 아무 말도 없는 것보다 낫다.

    이 걸음이 입은 skill은 지시 바로 다음에 절 하나로 온다 — 무엇을 하라는 말 뒤에 어떻게
    일하는가가 붙고, 그다음이 흘러 들어온 것이다. 어느 skill을 어떤 차례로 입었는지는 엔진이
    이미 풀어 건넸다(여기서 문서를 뒤지지 않는다).
    """
    written = [
        f"step: {ask.node.id} ({ask.node.type})",
        f"instruction: {ask.instruction or ask.prompt_ref}",
        *_skill_lines(ask.skills),
        "what has flowed in so far:",
        what_flowed_in(ask.state),
    ]
    if ask.ways:
        written.append("ways you can choose from: " + ", ".join(ask.ways))
    return "\n".join(written)


def prompt_of(system: str, said: str) -> str:
    """모델이 실제로 본 글 — 남겨 두어야 나중에 그 판단을 다시 읽을 수 있다 (설계 §8)."""
    return f"{system}\n\n{said}"


def one_way_only(ways: tuple[str, ...]) -> dict[str, object]:
    """길 이름 하나만 답이 되게 하는 모양 — 고를 수 없는 답을 아예 못 하게 조인다."""
    return {
        "type": "object",
        "properties": {"way": {"type": "string", "enum": list(ways)}},
        "required": ["way"],
        "additionalProperties": False,
    }


def _the_way_in(said: str) -> str | None:
    """조인 모양대로 온 답에서 길 이름을 꺼낸다 — 모양이 아니면 없다고 답한다."""
    try:
        answered = json.loads(said)
    except json.JSONDecodeError:
        return None
    if not isinstance(answered, dict):
        return None
    way = answered.get("way")
    return way if isinstance(way, str) else None


def heard(
    ask: ModelAsk,
    said: str | None,
    prompt: str,
    input_tokens: int,
    output_tokens: int,
    tool_calls: tuple[ToolCall, ...] = (),
) -> ModelSaid | ModelBalked:
    """들은 것을 계약의 답으로 옮긴다 — 갈림길에서는 그 말이 고른 길이어야 한다.

    도구를 시킨 답은 말이 없어도 온전한 답이다: 아직 답하는 중이라 할 말이 없을 뿐이다.
    그래서 갈림길이 도구를 부르는 중이면 모양 탓(WRONG_SHAPE)도 하지 않는다 — 길은 도구를
    다 쓴 다음 턴에 고른다. 아무 말도 없고 시킨 것도 없을 때만 들은 것이 없다고 말한다.

    길이 ways 밖인지는 여기서 따지지 않는다: 막다른 길인지는 그래프가 정한다 (P3-1).
    """
    if not said and not tool_calls:
        return trouble(NOTHING_SAID)
    way = _the_way_in(said) if ask.ways and said else None
    if ask.ways and way is None and not tool_calls:
        return trouble(WRONG_SHAPE)
    return ModelSaid(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        way=way,
        text=said or None,
        prompt=prompt,
        tool_calls=tool_calls,
    )


__all__ = [
    "CUT_SHORT",
    "DECLINED",
    "NOTHING_SAID",
    "NO_ANSWER",
    "PICKING_SYSTEM",
    "SPEAKING_SYSTEM",
    "WRONG_SHAPE",
    "cannot_take_tools",
    "heard",
    "instruction",
    "missing_key",
    "no_such_model",
    "one_way_only",
    "prompt_of",
    "system_for",
    "trouble",
    "what_flowed_in",
]
