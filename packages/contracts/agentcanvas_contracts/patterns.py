"""패턴 카탈로그 — 이 제품이 말할 수 있는 에이전트의 모양들 (설계 문서 D10·D14).

한 항목은 사람이 읽는 세 문장(무엇을 묻는가·언제 해당하는가·무슨 대가가 있는가), 이 서버가
그것을 할 수 있는지 판정할 능력 목록, 문서에 놓을 작업 템플릿, 그리고 "지금 그래프에 이게
빠져 있다"를 보는 규칙의 이름으로 이루어진다. 규칙의 본체는 엔진에 있다(계약은 아무것도
import하지 않는다). ReAct·supervisor 같은 원명은 여기 id로만 존재하고 화면에 나가지 않는다.

템플릿은 문서의 노드를 이름이 아니라 **앵커**로 가리킨다: `{agent}`·`{input}`·`{output}`은
그 종류의 첫 노드이고, `{new:gate}`처럼 적은 자리는 이 템플릿이 새로 놓는 노드다. 앵커를
실제 노드로 바꾸는 일은 문서를 아는 엔진이 한다.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .agent_spec import ContractModel, EdgeKind
from .localized import LocalizedText

#: 패턴 하나가 서려면 서버가 해낼 수 있어야 하는 것들 — 못 하는 서버는 목록에서 뺀다.
Capability = Literal["tool_calling", "human_gate", "router"]

#: 앵커의 생김새 — 그 종류의 첫 노드 셋과, 템플릿이 새로 놓는 자리.
ANCHOR_PATTERN = r"^\{(agent|input|output|new:[a-z][a-z0-9_]*)\}$"

#: "그 노드의 첫 포트" — 받는 값의 이름을 문서가 정하는 입력 노드를 가리킬 때 쓴다.
ANY_PORT = "*"

type NodeAnchor = Annotated[str, Field(pattern=ANCHOR_PATTERN)]


class TemplateEndpoint(ContractModel):
    node: NodeAnchor
    port: str = Field(min_length=1)


class AddNodeTemplateOp(ContractModel):
    op: Literal["add_node"]
    node: NodeAnchor
    type: str = Field(min_length=1)
    config: dict[str, object] = Field(default_factory=dict)


class ReplaceNodeConfigTemplateOp(ContractModel):
    """앵커가 가리키는 노드의 설정에 이 값들을 얹는다.

    `agent.patch/v1`의 replace_node_config는 설정을 통째로 갈아 끼우므로, 앵커를 채우는
    쪽이 문서의 설정 위에 이 값을 얹어 온전한 작업을 만든다 (모델 이름을 잃지 않는다).
    """

    op: Literal["replace_node_config"]
    node: NodeAnchor
    config: dict[str, object]


class RequireToolsTemplateOp(ContractModel):
    """이 앵커의 노드가 쓸 도구를 이미 고른 문서에서만 템플릿이 채워진다.

    작업이 아니라 조건이다: 도구가 없는 에이전트의 턴만 늘리면 쓰지 못하는 칸을 켜 두게 되고,
    사람은 무엇이 모자란지 듣지 못한다.
    """

    op: Literal["requires_tools"]
    node: NodeAnchor


class AddEdgeTemplateOp(ContractModel):
    op: Literal["add_edge"]
    kind: EdgeKind
    source: TemplateEndpoint
    target: TemplateEndpoint


class RemoveEdgeTemplateOp(ContractModel):
    """두 앵커 사이의 연결을 걷어낸다 — 연결의 id는 문서마다 다르므로 양 끝으로 적는다."""

    op: Literal["remove_edge"]
    source: NodeAnchor
    target: NodeAnchor


type TemplateOp = Annotated[
    AddNodeTemplateOp
    | ReplaceNodeConfigTemplateOp
    | RequireToolsTemplateOp
    | AddEdgeTemplateOp
    | RemoveEdgeTemplateOp,
    Field(discriminator="op"),
]

type PatchTemplate = list[TemplateOp]


class PatternDef(ContractModel):
    """카탈로그의 한 항목 — 물음과 근거와 대가, 그리고 그것을 문서에 놓는 방법."""

    #: 코드가 이 모양을 부르는 이름. 화면은 이 이름 대신 아래 세 문장을 읽는다.
    id: str = Field(min_length=1)
    question: LocalizedText
    applies_when: LocalizedText
    cost: LocalizedText
    needs: tuple[Capability, ...]
    template: PatchTemplate
    #: 지금 그래프에 이 모양이 빠져 있는지 보는 순수 규칙의 이름 — 본체는 엔진의 표에 있다.
    detects: str = Field(min_length=1)


DEFAULT_PATTERNS: dict[str, PatternDef] = {
    pattern.id: pattern
    for pattern in [
        PatternDef.model_validate(
            {
                "id": "react",
                "question": {
                    "ko": "이 에이전트가 회사 시스템이나 바깥에서 무언가 찾아봐야 하나요?",
                    "en": (
                        "Does this agent need to look things up in your systems "
                        "or outside?"
                    ),
                },
                "applies_when": {
                    "ko": "부탁에 '찾아본다·조회한다·확인한다·가져온다' 같은 말이 있을 때",
                    "en": (
                        "When the request says things like look up, check, "
                        "fetch, or find out"
                    ),
                },
                "cost": {
                    "ko": (
                        "실행이 길어지고, 도구를 부를 때 사람 승인이 생길 수 있어요 — "
                        "턴마다 모델 호출 비용이 들어요"
                    ),
                    "en": (
                        "Runs take longer, and calling a tool can ask a person to "
                        "approve it — each turn costs a model call"
                    ),
                },
                "needs": ["tool_calling"],
                "template": [
                    {"op": "requires_tools", "node": "{agent}"},
                    {
                        "op": "replace_node_config",
                        "node": "{agent}",
                        # 도구를 붙이는 것(toolset_refs)은 사람이 고른다 — 템플릿이 남의
                        # 문서의 연결을 지어내지 않는다.
                        "config": {"max_turns": 3},
                    },
                ],
                "detects": "agent_calls_tools_once",
            }
        ),
        PatternDef.model_validate(
            {
                "id": "human_gate",
                "question": {
                    "ko": "이 에이전트가 뭔가 하기 전에 사람이 확인해야 하나요?",
                    "en": "Should a person approve before it acts?",
                },
                "applies_when": {
                    "ko": "부탁에 '승인·확인·검토 후·보내기 전' 같은 말이 있을 때",
                    "en": (
                        "When the request says things like approve, review first, "
                        "or before it sends"
                    ),
                },
                "cost": {
                    "ko": "실행이 사람 확인에서 멈춰 기다려요",
                    "en": "The run stops at the check and waits for a person",
                },
                "needs": ["human_gate"],
                "template": [
                    {
                        "op": "add_node",
                        "node": "{new:gate}",
                        "type": "control.human_gate",
                        "config": {"approval_schema_ref": "schema://answer-review@1"},
                    },
                    {"op": "remove_edge", "source": "{agent}", "target": "{output}"},
                    {
                        "op": "add_edge",
                        "kind": "approval",
                        "source": {"node": "{agent}", "port": "response"},
                        "target": {"node": "{new:gate}", "port": "review"},
                    },
                    {
                        "op": "add_edge",
                        "kind": "control",
                        "source": {"node": "{new:gate}", "port": "approved"},
                        "target": {"node": "{output}", "port": "input"},
                    },
                ],
                "detects": "acts_without_a_person",
            }
        ),
        PatternDef.model_validate(
            {
                "id": "router",
                "question": {
                    "ko": (
                        "이 에이전트가 하는 일이 여러 갈래인가요? "
                        "갈래마다 다르게 답해야 하나요?"
                    ),
                    "en": "Does it do several different jobs, each answered differently?",
                },
                "applies_when": {
                    "ko": "부탁에 '~이면 A, ~이면 B' 같은 갈래가 있을 때",
                    "en": (
                        "When the request forks — if it is this, do A; if it is "
                        "that, do B"
                    ),
                },
                "cost": {
                    "ko": "갈림길 판단에 모델 호출이 한 번 더 들어요",
                    "en": "Picking the way costs one more model call",
                },
                "needs": ["router"],
                "template": [
                    {
                        "op": "add_node",
                        "node": "{new:router}",
                        "type": "llm.router",
                        "config": {"model_ref": "model://default"},
                    },
                    {
                        "op": "add_edge",
                        "kind": "data",
                        "source": {"node": "{input}", "port": ANY_PORT},
                        "target": {"node": "{new:router}", "port": "input"},
                    },
                    {
                        "op": "add_edge",
                        "kind": "control",
                        # 어느 갈래로 갈지의 조건은 사람이 적는다.
                        "source": {"node": "{new:router}", "port": "route"},
                        "target": {"node": "{agent}", "port": "messages"},
                    },
                ],
                "detects": "one_path_only",
            }
        ),
    ]
}


def resolve_pattern(pattern_id: str) -> PatternDef | None:
    """id가 가리키는 패턴을 돌려준다 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return DEFAULT_PATTERNS.get(pattern_id)


__all__ = [
    "ANCHOR_PATTERN",
    "ANY_PORT",
    "DEFAULT_PATTERNS",
    "AddEdgeTemplateOp",
    "AddNodeTemplateOp",
    "Capability",
    "NodeAnchor",
    "PatchTemplate",
    "PatternDef",
    "RemoveEdgeTemplateOp",
    "ReplaceNodeConfigTemplateOp",
    "RequireToolsTemplateOp",
    "TemplateEndpoint",
    "TemplateOp",
    "resolve_pattern",
]
