// 한 노드가 도구를 부르며 여러 번 시도한 실행을 시도 단위로 읽는 규칙 (순수).
// 묶음의 정체는 (노드, turn)이고, 머리말은 일어난 일만 말한다 (DESIGN §7 run-turns).
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { toFlow } from "../src/graph/serialize";
import { translate } from "../src/i18n/messages";
import { nodeRunFacts } from "../src/run/player";
import { markedForRun } from "../src/run/runMarks";
import { groupTurns } from "../src/run/turns";
import { turnWords } from "../src/run/turnWords";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";
const TOOL = "search_article";
const OTHER_TOOL = "get_article";

function event(
  seq: number,
  event_type: RunEvent["event_type"],
  fields: Partial<RunEvent> = {},
): RunEvent {
  return {
    run_id: "run_turns",
    seq,
    event_type,
    timestamp: "2026-09-04T12:30:00.000Z",
    spec_revision: example.revision,
    node_id: AGENT,
    payload: {},
    ...fields,
  };
}

function asked(turn: number, seq: number, closing = false): RunEvent {
  return event(seq, "llm.requested", { turn, payload: { closing } });
}

function heard(turn: number, seq: number, calls: string[] = []): RunEvent {
  return event(seq, "llm.completed", {
    turn,
    payload: {
      tool_calls: calls.map((name, index) => ({
        call_id: `call-${index}`,
        name,
        arguments: {},
      })),
    },
  });
}

function called(turn: number, seq: number, name: string): RunEvent {
  return event(seq, "tool.requested", {
    turn,
    payload: { call_id: "call-0", tool_name: name, resource_ref: "clinical-reference" },
  });
}

/** 도구 하나를 부르고 그 답을 들은 한 시도 — 엔진이 남기는 차례 그대로. */
function toolTurn(turn: number, seq: number, name = TOOL): RunEvent[] {
  return [asked(turn, seq), heard(turn, seq + 1, [name]), called(turn, seq + 2, name)];
}

/** 도구 없이 답한 한 시도. */
function answerTurn(turn: number, seq: number, closing = false): RunEvent[] {
  return [asked(turn, seq, closing), heard(turn, seq + 1)];
}

function headings(events: RunEvent[], spec: AgentSpec = example): (string | null)[] {
  return groupTurns(events).map((part) => {
    const words = turnWords(part, spec);
    return words === null ? null : translate("ko", words.heading);
  });
}

function captions(events: RunEvent[], spec: AgentSpec = example): string[][] {
  return groupTurns(events).flatMap((part) => {
    const words = turnWords(part, spec);
    return words === null
      ? []
      : [words.caption.map((one) => (typeof one === "string" ? one : one.ko))];
  });
}

describe("사건을 시도 단위로 묶는 규칙", () => {
  it("시도 번호가 없는 사건은 저마다 한 묶음이고 머리말이 없다", () => {
    const events = [event(0, "run.started"), event(1, "node.started")];

    const parts = groupTurns(events);

    expect(parts.map((part) => part.turn)).toEqual([null, null]);
    expect(parts.map((part) => part.events.length)).toEqual([1, 1]);
    expect(headings(events)).toEqual([null, null]);
  });

  it("한 노드의 시도 하나가 그 시도의 사건을 모두 담는다", () => {
    const events = [...toolTurn(0, 1), ...answerTurn(1, 4)];

    const parts = groupTurns(events);

    expect(parts.map((part) => part.turn)).toEqual([0, 1]);
    expect(parts.map((part) => part.events.map((one) => one.seq))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("두 노드가 저마다 첫 시도를 돌면 노드별로 갈라 묶는다", () => {
    const events = [...toolTurn(0, 0), event(3, "llm.requested", { turn: 0, node_id: "triage" })];

    const parts = groupTurns(events);

    expect(parts.map((part) => part.nodeId)).toEqual([AGENT, "triage"]);
    expect(parts.map((part) => part.events.length)).toEqual([3, 1]);
  });
});

// 승인으로 멈췄다 이어진 시도 — 엔진의 차례 그대로 (packages/engine/tests/test_agent_loop.py).
describe("사람 확인으로 끊겼다 이어진 시도", () => {
  const events = [
    event(0, "node.started"),
    event(1, "prompt.compiled", { turn: 0 }),
    asked(0, 2),
    heard(0, 3, [TOOL]),
    event(4, "tool.policy_checked", { turn: 0, payload: { tool_name: TOOL } }),
    event(5, "human.approval_requested", { turn: 0, payload: { tool_name: TOOL } }),
    event(6, "run.paused"),
    event(7, "run.resumed"),
    called(0, 8, TOOL),
    event(9, "tool.completed", { turn: 0, payload: { call_id: "call-0", ok: true } }),
    ...answerTurn(1, 10),
    event(12, "node.completed", { payload: { turns: 2, closed_by: "answer" } }),
  ];

  it("한 시도가 두 자리에 나뉘어도 그 시도의 사건은 하나로 읽힌다", () => {
    const parts = groupTurns(events);
    const first = parts.find((part) => part.turn === 0);

    expect(first?.whole.map((one) => one.seq)).toEqual([1, 2, 3, 4, 5, 8, 9]);
  });

  it("머리말은 그 시도에 한 번만 선다", () => {
    expect(headings(events).filter((line) => line !== null)).toEqual([
      "1번째 시도 — 'search_article' 도구를 불렀어요",
      "2번째 시도 — 답했어요",
    ]);
  });

  it("이어진 뒷부분도 그 시도의 자리다 — 들여쓰기를 물려받는다", () => {
    const continued = groupTurns(events).filter((part) => part.turn === 0 && !part.heads);

    expect(continued.flatMap((part) => part.events.map((one) => one.seq))).toEqual([8, 9]);
  });

  it("멈추고 이어진 줄 자체는 어느 시도에도 들지 않는다", () => {
    const loose = groupTurns(events).filter((part) => part.turn === null);

    expect(loose.flatMap((part) => part.events.map((one) => one.event_type))).toEqual([
      "node.started",
      "run.paused",
      "run.resumed",
      "node.completed",
    ]);
  });
});

describe("머리말은 일어난 일만 말한다", () => {
  it("아직 답이 오지 않은 시도는 물어보는 중이라고만 말한다", () => {
    expect(headings([asked(0, 0)])).toEqual(["1번째 시도 — 물어보는 중이에요"]);
  });

  it("실제로 부른 도구는 그 도구의 이름으로 부른다", () => {
    expect(headings(toolTurn(0, 0))).toEqual([
      "1번째 시도 — 'search_article' 도구를 불렀어요",
    ]);
  });

  it("도구의 쉬운 설명은 머리말이 아니라 caption이다", () => {
    expect(captions(toolTurn(0, 0))).toEqual([
      ["물어본 것과 관련 있는 진료 지침 글을 찾아 목록으로 돌려준다."],
    ]);
  });

  it("문서에 없는 도구는 이름만 부르고 설명을 지어내지 않는다", () => {
    const noTools: AgentSpec = { ...example, resources: [] };

    expect(headings(toolTurn(0, 0), noTools)).toEqual([
      "1번째 시도 — 'search_article' 도구를 불렀어요",
    ]);
    expect(captions(toolTurn(0, 0), noTools)).toEqual([[]]);
  });

  it("도구를 둘 불렀으면 둘 다 이름을 부른다", () => {
    const events = [
      asked(0, 0),
      heard(0, 1, [TOOL, OTHER_TOOL]),
      called(0, 2, TOOL),
      called(0, 3, OTHER_TOOL),
    ];

    expect(headings(events)).toEqual([
      "1번째 시도 — 'search_article'·'get_article' 도구를 불렀어요",
    ]);
  });

  it("셋 이상이면 개수로 말하고 원문 이름은 caption에 모두 적는다", () => {
    const events = [
      asked(0, 0),
      heard(0, 1, [TOOL, OTHER_TOOL, TOOL]),
      called(0, 2, TOOL),
      called(0, 3, OTHER_TOOL),
      called(0, 4, TOOL),
    ];

    expect(headings(events)).toEqual(["1번째 시도 — 도구 3개를 불렀어요"]);
    expect(captions(events)).toEqual([[TOOL, OTHER_TOOL, TOOL]]);
  });

  it("모델이 시켰어도 부르지 않은 도구는 세지 않는다", () => {
    const events = [asked(0, 0), heard(0, 1, [TOOL, OTHER_TOOL]), called(0, 2, TOOL)];

    expect(headings(events)).toEqual([
      "1번째 시도 — 'search_article' 도구를 불렀어요",
    ]);
  });

  it("도구 없이 답한 시도는 답했다고만 말한다", () => {
    expect(headings(answerTurn(1, 0))).toEqual(["2번째 시도 — 답했어요"]);
  });

  it("마무리 호출은 여기까지 알아본 것으로 답했다고 말한다", () => {
    expect(headings(answerTurn(2, 0, true))).toEqual([
      "여기까지 알아본 것으로 답했어요",
    ]);
  });

  it("마무리 호출에서 모델이 시킨 도구는 적지 않는다 — 엔진이 부르지 않는다", () => {
    const events = [asked(2, 0, true), heard(2, 1, [TOOL])];

    expect(headings(events)).toEqual(["여기까지 알아본 것으로 답했어요"]);
    expect(captions(events)).toEqual([[]]);
  });
});

describe("노드 카드가 시도를 읽는 표시", () => {
  const looping = [
    event(0, "node.started"),
    ...toolTurn(0, 1),
    event(4, "tool.completed", { turn: 0, payload: { call_id: "call-0", ok: true } }),
  ];

  it("루프가 도는 동안 지금 몇 번째 시도인지 남긴다", () => {
    expect(nodeRunFacts(looping, 4)[AGENT]).toMatchObject({ status: "running", turn: 0 });
  });

  it("재생 위치보다 뒤의 시도는 아직 일어나지 않은 일이다", () => {
    expect(nodeRunFacts(looping, 0)[AGENT]?.turn).toBeUndefined();
  });

  it("마무리 호출 중인 노드는 그 사실을 남긴다", () => {
    const events = [...looping, asked(1, 5, true)];

    expect(nodeRunFacts(events, 5)[AGENT]).toMatchObject({ turn: 1, closing: true });
  });

  it("마무리가 아닌 다음 시도로 넘어가면 마무리 표시는 남지 않는다", () => {
    const events = [...looping, asked(1, 5, true), asked(2, 6)];

    expect(nodeRunFacts(events, 6)[AGENT]?.closing).toBeUndefined();
  });

  it("한도로 마무리한 노드는 일찍 닫혔다고 남긴다", () => {
    const events = [
      ...looping,
      event(5, "node.completed", { payload: { turns: 2, closed_by: "turn_limit" } }),
    ];

    expect(nodeRunFacts(events, 5)[AGENT]?.closedEarly).toBe(true);
  });

  it("도구 예산으로 마무리한 노드도 일찍 닫힌 것이다", () => {
    const events = [
      ...looping,
      event(5, "node.completed", { payload: { turns: 2, closed_by: "tool_budget" } }),
    ];

    expect(nodeRunFacts(events, 5)[AGENT]?.closedEarly).toBe(true);
  });

  it("답해서 끝난 노드는 일찍 닫힌 것이 아니다", () => {
    const events = [
      ...looping,
      event(5, "node.completed", { payload: { turns: 2, closed_by: "answer" } }),
    ];

    expect(nodeRunFacts(events, 5)[AGENT]?.closedEarly).toBeUndefined();
  });

  it("카드는 지금 시도와 문서가 정한 최대 시도를 함께 받는다", () => {
    const marked = markedForRun(toFlow(example), nodeRunFacts(looping, 4), {});
    const card = marked.nodes.find((node) => node.id === AGENT);

    expect(card?.data.runTurn).toBe(0);
    expect(card?.data.runMaxTurns).toBe(4);
  });

  it("최대 시도를 적지 않은 문서는 계약이 정한 기본값으로 읽는다", () => {
    const spec: AgentSpec = {
      ...example,
      nodes: example.nodes.map(({ config, ...node }) =>
        node.id === AGENT ? node : { ...node, config },
      ),
    };

    const marked = markedForRun(toFlow(spec), nodeRunFacts(looping, 4), {});

    expect(marked.nodes.find((node) => node.id === AGENT)?.data.runMaxTurns).toBe(1);
  });

  it("문서가 적은 수가 계약이 막는 수(0 이하)면 기본값으로 읽는다", () => {
    const spec: AgentSpec = {
      ...example,
      nodes: example.nodes.map((node) =>
        node.id === AGENT ? { ...node, config: { ...node.config, max_turns: 0 } } : node,
      ),
    };

    const marked = markedForRun(toFlow(spec), nodeRunFacts(looping, 4), {});

    expect(marked.nodes.find((node) => node.id === AGENT)?.data.runMaxTurns).toBe(1);
  });

  it("일찍 닫힌 노드의 카드가 그 사실을 받는다", () => {
    const events = [
      ...looping,
      event(5, "node.completed", { payload: { turns: 2, closed_by: "tool_budget" } }),
    ];

    const marked = markedForRun(toFlow(example), nodeRunFacts(events, 5), {});

    expect(marked.nodes.find((node) => node.id === AGENT)?.data.runClosedEarly).toBe(true);
  });

  it("마무리 호출 중인 노드의 카드가 그 사실을 받는다", () => {
    const events = [...looping, asked(1, 5, true)];

    const marked = markedForRun(toFlow(example), nodeRunFacts(events, 5), {});

    expect(marked.nodes.find((node) => node.id === AGENT)?.data.runClosing).toBe(true);
  });

  it("시도 표시가 없는 노드에는 아무것도 얹지 않는다", () => {
    const marked = markedForRun(toFlow(example), nodeRunFacts(looping, 4), {});
    const other = marked.nodes.find((node) => node.id !== AGENT);

    expect(other?.data.runTurn).toBeUndefined();
    expect(other?.data.runClosedEarly).toBeUndefined();
  });
});
