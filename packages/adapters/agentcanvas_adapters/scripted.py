"""진짜 클라이언트가 설 자리에 서는 결정론 대역 — 적어 둔 답을 차례로 내주고, 받은 청을 기억한다.

시험마다 손으로 지어낸 가짜를 만들지 않는다: 대역도 이 층의 공개 계약이다 (다시 틀어 보는
실행은 1급 provider다 — 설계 문서 §3). 진짜와 같은 자리(`client.messages.create`)로 불리므로,
진짜에게 보낼 것을 그대로 대역에게도 보낸다.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

from agentcanvas_engine.evaluation.entailment import Entailment


@dataclass(frozen=True)
class ScriptedToolCall:
    """대역이 시키는 도구 호출 하나 — 인자는 저쪽이 실어 오는 모습 그대로 적는다.

    풀지 않은 채 두는 까닭: 읽을 수 없는 인자가 왔을 때를 각본으로 줄 수 있어야 한다.
    """

    call_id: str
    name: str
    #: 대개는 JSON 글이지만, 이미 풀린 판을 실어 오는 서빙도 있다 — 대역은 둘 다 설 수 있다.
    arguments: str | object = "{}"


@dataclass(frozen=True)
class _Text:
    """말이 담긴 조각 — 진짜 응답의 text 블록이 서는 자리."""

    text: str
    type: str = "text"


@dataclass(frozen=True)
class _ToolUse:
    """도구를 시킨 조각 — Anthropic 응답의 tool_use 블록이 서는 자리."""

    id: str
    name: str
    input: dict[str, object]
    type: str = "tool_use"


@dataclass(frozen=True)
class _Usage:
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class _Answer:
    """대역이 돌려주는 응답 — 진짜 응답에서 이 층이 읽는 것만 들고 있다."""

    stop_reason: str
    content: list[_Text | _ToolUse]
    usage: _Usage


@dataclass(frozen=True)
class ScriptedReply:
    """대역이 할 말 한 마디 — 무엇을 말하고, 왜 멈췄고, 얼마나 큰가."""

    text: str
    stop_reason: str = "end_turn"
    input_tokens: int = 12
    output_tokens: int = 5
    #: 말 조각이 하나도 없는 응답 — 도구만 부르고 아무 말도 하지 않은 자리를 흉내 낸다.
    speaks: bool = True
    #: 이 답이 시킨 도구 호출들 — 말과 나란히 오거나, 말 없이 이것만 오거나.
    tool_calls: tuple[ScriptedToolCall, ...] = ()

    @classmethod
    def with_no_text(cls) -> ScriptedReply:
        return cls(text="", speaks=False)

    @classmethod
    def with_tool_calls(
        cls, calls: Sequence[ScriptedToolCall], text: str | None = None
    ) -> ScriptedReply:
        """도구를 시킨 답 한 마디 — 말을 적지 않으면 도구만 시키고 아무 말도 하지 않는다."""
        return cls(
            text=text or "",
            stop_reason="tool_use",
            speaks=text is not None,
            tool_calls=tuple(calls),
        )

    def answered(self) -> _Answer:
        spoken: list[_Text | _ToolUse] = [_Text(self.text)] if self.speaks else []
        return _Answer(
            stop_reason=self.stop_reason,
            content=[
                *spoken,
                *(
                    _ToolUse(
                        call.call_id,
                        call.name,
                        json.loads(call.arguments)
                        if isinstance(call.arguments, str)
                        else call.arguments,
                    )
                    for call in self.tool_calls
                ),
            ],
            usage=_Usage(self.input_tokens, self.output_tokens),
        )


class _ScriptedMessages:
    """진짜 클라이언트의 `messages` 자리 — 청을 적어 두고 다음 답을 내준다."""

    def __init__(self, llm: ScriptedLLM) -> None:
        self._llm = llm

    def create(self, **request: object) -> _Answer:
        return self._llm.next_answer(request)


class ScriptedLLM:
    """적어 둔 답을 차례로 하는 클라이언트 — 예외를 적어 두면 그 자리에서 그것이 일어난다."""

    def __init__(self, replies: Sequence[ScriptedReply | Exception] = ()) -> None:
        self._replies = list(replies)
        self._said = 0
        #: 대역이 받은 청들 — 무엇을 보냈는지는 시험이 직접 읽어 확인한다.
        self.requests: list[dict[str, object]] = []
        self.messages = _ScriptedMessages(self)

    def next_answer(self, request: dict[str, object]) -> _Answer:
        """다음 차례의 답 — 적어 둔 말이 떨어지면 조용히 지어내지 않고 크게 말한다."""
        self.requests.append(request)
        assert self._said < len(self._replies), (
            "the stand-in was asked more times than it was given answers"
        )
        reply = self._replies[self._said]
        self._said += 1
        if isinstance(reply, Exception):
            raise reply
        return reply.answered()


@dataclass(frozen=True)
class _Function:
    name: str
    arguments: str


@dataclass(frozen=True)
class _CalledTool:
    """OpenAI 말투로 온 도구 호출 하나 — 인자는 저쪽이 실어 오는 그대로 JSON 글이다."""

    id: str
    function: _Function
    type: str = "function"


@dataclass(frozen=True)
class _Message:
    content: str | None
    tool_calls: list[_CalledTool] | None = None


@dataclass(frozen=True)
class _Choice:
    message: _Message
    finish_reason: str


@dataclass(frozen=True)
class _ChatUsage:
    prompt_tokens: int
    completion_tokens: int


@dataclass(frozen=True)
class _Completion:
    """OpenAI 말투로 온 응답 — 이 층이 읽는 것만 들고 있다."""

    choices: list[_Choice]
    usage: _ChatUsage


@dataclass(frozen=True)
class ScriptedChoice:
    """OpenAI 말투를 쓰는 곳의 답 한 마디 — 무엇을 말하고, 왜 멈췄고, 얼마나 컸는가."""

    text: str | None
    finish_reason: str = "stop"
    prompt_tokens: int = 12
    completion_tokens: int = 5
    #: 답한 자리가 하나도 없는 응답 — 아무것도 고르지 못한 자리를 흉내 낸다.
    answers: bool = True
    #: 이 답이 시킨 도구 호출들 — 말과 나란히 오거나, 말 없이 이것만 오거나.
    tool_calls: tuple[ScriptedToolCall, ...] = ()

    @classmethod
    def with_no_choice_at_all(cls) -> ScriptedChoice:
        return cls(text=None, answers=False)

    @classmethod
    def with_tool_calls(
        cls, calls: Sequence[ScriptedToolCall], text: str | None = None
    ) -> ScriptedChoice:
        """도구를 시킨 답 한 마디 — 저쪽은 이때 tool_calls로 멈췄다고 말한다."""
        return cls(text=text, finish_reason="tool_calls", tool_calls=tuple(calls))

    def _message(self) -> _Message:
        return _Message(
            self.text,
            [
                _CalledTool(call.call_id, _Function(call.name, call.arguments))
                for call in self.tool_calls
            ]
            or None,
        )

    def completed(self) -> _Completion:
        return _Completion(
            choices=(
                [_Choice(self._message(), self.finish_reason)] if self.answers else []
            ),
            usage=_ChatUsage(self.prompt_tokens, self.completion_tokens),
        )


class _ScriptedCompletions:
    """진짜 클라이언트의 `chat.completions` 자리 — 청을 적어 두고 다음 답을 내준다."""

    def __init__(self, llm: ScriptedOpenAI) -> None:
        self._llm = llm

    def create(self, **request: object) -> _Completion:
        return self._llm.next_completion(request)


class _ScriptedChat:
    def __init__(self, llm: ScriptedOpenAI) -> None:
        self.completions = _ScriptedCompletions(llm)


class ScriptedOpenAI:
    """OpenAI 말투를 쓰는 클라이언트의 대역 — 적어 둔 답을 차례로 하고, 받은 청을 기억한다."""

    def __init__(self, replies: Sequence[ScriptedChoice | Exception] = ()) -> None:
        self._replies = list(replies)
        self._said = 0
        #: 대역이 받은 청들 — 무엇을 보냈는지는 시험이 직접 읽어 확인한다.
        self.requests: list[dict[str, object]] = []
        self.chat = _ScriptedChat(self)

    def next_completion(self, request: dict[str, object]) -> _Completion:
        """다음 차례의 답 — 적어 둔 말이 떨어지면 조용히 지어내지 않고 크게 말한다."""
        self.requests.append(request)
        assert self._said < len(self._replies), (
            "the stand-in was asked more times than it was given answers"
        )
        reply = self._replies[self._said]
        self._said += 1
        if isinstance(reply, Exception):
            raise reply
        return reply.completed()


class ScriptedEntailment:
    """함의를 묻는 자리의 대역 — 적어 둔 답을 차례로 하고, 무엇을 물었는지 기억한다."""

    def __init__(
        self, answers: Sequence[bool] = (), model_ref: str = "scripted"
    ) -> None:
        self._answers = list(answers)
        #: 진짜와 같은 자리에 선다는 뜻 — 판정을 기억해 두는 열쇠에 이 정체가 들어간다.
        self.model_ref = model_ref
        #: 대역이 받은 (진술, 본문)들 — 무엇을 물었는지는 시험이 직접 읽어 확인한다.
        self.asked: list[tuple[str, str]] = []

    def __call__(self, statement: str, body: str) -> Entailment:
        """다음 차례의 답 — 적어 둔 답이 떨어지면 조용히 지어내지 않고 크게 말한다."""
        assert len(self.asked) < len(self._answers), (
            "the stand-in was asked more times than it was given answers"
        )
        self.asked.append((statement, body))
        return Entailment(entailed=self._answers[len(self.asked) - 1])


__all__ = [
    "ScriptedChoice",
    "ScriptedEntailment",
    "ScriptedLLM",
    "ScriptedOpenAI",
    "ScriptedReply",
    "ScriptedToolCall",
]
