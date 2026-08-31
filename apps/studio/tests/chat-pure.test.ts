// 대화의 규칙을 순수 함수로 고정한다 — 문을 열 수 있는가(F1~F4), 무엇을 실어 보내는가(G2),
// 이 말이 어떻게 끝났는가(G1·G5·H2), 어느 판과 이야기하는가(G4).
// 화면도 store도 이 답을 그대로 그린다: 판단이 두 벌로 갈라지지 않게 여기서 한 번만 정한다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { chatDoorTrouble } from "../src/chat/chatEntry";
import { chatPinWords } from "../src/chat/chatPin";
import {
  type ChatTurnState,
  chatHistory,
  chatTurnEnd,
  chatTurnInput,
} from "../src/chat/chatTurn";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import type { SpecPublication } from "../src/generated/spec_publication";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

/** 사람 말을 받는 판 — 입력 노드가 message를 받는다 (결정 1). */
function graphTaking(...names: string[]): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.type === "core.input"
        ? {
            ...node,
            config: {
              bindings: Object.fromEntries(names.map((name) => [name, `input.${name}`])),
            },
          }
        : node,
    ),
  } as AgentSpec;
}

const published: SpecPublication = {
  spec_id: example.id,
  revision: example.revision,
  published_at: "2026-08-01T12:00:00Z",
};

let seq = 0;

function event(
  event_type: RunEvent["event_type"],
  payload: Record<string, unknown> = {},
  nodeId?: string,
): RunEvent {
  seq += 1;
  return {
    event_type,
    payload,
    run_id: "run_1",
    seq,
    spec_revision: example.revision,
    timestamp: "2026-08-01T12:30:00Z",
    ...(nodeId ? { node_id: nodeId } : {}),
  };
}

function turn(said: string, events: RunEvent[] = []): ChatTurnState {
  return { id: "t1", said, runId: "run_1", events, halted: null };
}

describe("대화 문을 열 수 있는가 (F1~F4)", () => {
  /** 문 앞의 사실들 — 적지 않은 것은 "없다"가 아니라 기본값이다. */
  function door(known: Partial<Parameters<typeof chatDoorTrouble>[0]> = {}) {
    return chatDoorTrouble({
      hasDoc: true,
      publication: published,
      publishedSpec: null,
      publishedSpecFailure: null,
      ...known,
    });
  }

  it("문서가 없으면 열 수 없다", () => {
    expect(door({ hasDoc: false })?.block).toBe("noDoc");
  });

  it("내놓은 판이 없으면 열 수 없다", () => {
    expect(door({ publication: null })?.block).toBe("notPublished");
  });

  it("내놓은 판을 아직 못 읽었으면 모르는 채로 둔다 — 없다고 말하지 않는다", () => {
    expect(door()?.block).toBe("checking");
  });

  it("게시된 판이 사람 말을 받지 않으면 열 수 없다", () => {
    expect(door({ publishedSpec: graphTaking("question") })?.block).toBe("noMessageInput");
  });

  it("게시된 판이 message를 받으면 열린다", () => {
    expect(door({ publishedSpec: graphTaking("message") })).toBeNull();
  });

  // M1 — 새 판이 게시된 직후, 손에 든 것은 아직 옛 판의 몸통이다.
  it("들고 있는 몸통이 지금 내놓은 판의 것이 아니면 그것으로 판정하지 않는다", () => {
    const trouble = door({
      publication: { ...published, revision: `sha256:${"b".repeat(64)}` },
      publishedSpec: graphTaking("message"),
    });

    expect(trouble?.block).toBe("checking");
  });

  // M2 — 못 읽었으면 "확인 중"이라고 거짓말하지 않는다.
  it("서버에 닿지 못해 못 읽었으면 그 사실과 다음 걸음을 말한다", () => {
    const trouble = door({ publishedSpecFailure: { key: "open.offline" } });

    expect(trouble?.block).toBe("checkFailed");
    const words = translate("ko", trouble!.words);
    expect(words).toContain("확인하지 못했어요");
    expect(words).toContain("다시");
  });

  it("그 판이 서버에 없어서 못 읽은 것은 닿지 못한 것과 다른 말이다", () => {
    const gone = translate("ko", door({ publishedSpecFailure: { key: "open.notFound" } })!.words);
    const offline = translate("ko", door({ publishedSpecFailure: { key: "open.offline" } })!.words);

    expect(gone).not.toBe(offline);
    expect(gone).toContain("다시");
  });

  // §9 — 서버가 보낸 원문은 어떤 자리로도 화면에 나오지 않는다.
  it("서버가 까닭을 적어 보낸 실패는 원문 없이 한 갈래로 말한다", () => {
    const trouble = door({
      publishedSpecFailure: {
        key: "open.failed",
        params: { reason: "invalid credentials" },
      },
    });

    const words = translate("ko", trouble!.words);
    expect(words).not.toContain("invalid credentials");
    expect(words).toContain("확인하지 못했어요");
    expect(words).toContain("다시");
  });

  it("못 여는 까닭마다 다음 걸음을 말한다", () => {
    expect(translate("ko", door({ publication: null })!.words)).toContain("게시");
    expect(
      translate("ko", door({ publishedSpec: graphTaking("question") })!.words),
    ).toContain("message");
    expect(translate("en", door({ hasDoc: false })!.words)).not.toBe("");
  });
});

describe("이번 말에 실어 보내는 것 (G2)", () => {
  it("사람 말은 message 자리에 실린다", () => {
    const input = chatTurnInput(graphTaking("message"), "안녕", []);

    expect(input).toEqual({ message: "안녕" });
  });

  it("history를 받는 판이면 지난 대화도 함께 실린다", () => {
    const said = [
      { role: "user" as const, text: "안녕" },
      { role: "assistant" as const, text: "반가워요" },
    ];

    const input = chatTurnInput(graphTaking("message", "history"), "잘 지내?", said);

    expect(input).toEqual({ message: "잘 지내?", history: said });
  });

  it("history를 받지 않는 판에는 지난 대화를 싣지 않는다", () => {
    const input = chatTurnInput(graphTaking("message"), "잘 지내?", [
      { role: "user", text: "안녕" },
    ]);

    expect(input).toEqual({ message: "잘 지내?" });
  });

  it("지난 대화가 없으면 빈 목록을 실어 보내지 않는다", () => {
    const input = chatTurnInput(graphTaking("message", "history"), "안녕", []);

    expect(input).toEqual({ message: "안녕" });
  });
});

describe("지난 대화를 모으는 법 (G2)", () => {
  it("답이 온 말만 오간 순서대로 선다", () => {
    const first = turn("안녕", [
      event("llm.completed", { text: "반가워요" }, "clinical-agent"),
      event("run.completed", {}),
    ]);
    const asking = turn("지금 뭐 해?");

    expect(chatHistory(graphTaking("message"), [first, asking])).toEqual([
      { role: "user", text: "안녕" },
      { role: "assistant", text: "반가워요" },
    ]);
  });

  it("실패한 말은 지난 대화가 아니다 — 없던 답을 지어내지 않는다", () => {
    const failed = turn("안녕", [event("run.failed", { reason: "provider_error" })]);

    expect(chatHistory(graphTaking("message"), [failed])).toEqual([]);
  });
});

describe("이 말이 어떻게 끝났는가", () => {
  it("아직 끝나지 않았으면 끝이 없다 (G1 대기)", () => {
    const going = turn("안녕", [event("run.started", {})]);

    expect(chatTurnEnd(graphTaking("message"), going)).toBeNull();
  });

  it("마친 실행의 마지막 말이 답이다 (G1)", () => {
    const done = turn("안녕", [
      event("llm.completed", { text: "반가워요" }, "clinical-agent"),
      event("run.completed", {}),
    ]);

    expect(chatTurnEnd(graphTaking("message"), done)).toEqual({
      kind: "answer",
      text: "반가워요",
    });
  });

  it("갈림길이 고른 봉투는 답이 아니다", () => {
    const done = turn("안녕", [
      event("llm.completed", { text: "반가워요" }, "clinical-agent"),
      event("llm.completed", { text: '{"route":"urgent"}' }, "triage"),
      event("run.completed", {}),
    ]);

    expect(chatTurnEnd(graphTaking("message"), done)).toEqual({
      kind: "answer",
      text: "반가워요",
    });
  });

  it("실패한 실행은 갈래대로 쉬운 말을 들고 끝난다 (G5)", () => {
    const failed = turn("안녕", [event("run.failed", { reason: "provider_error" })]);

    const end = chatTurnEnd(graphTaking("message"), failed);

    expect(end?.kind).toBe("failed");
    expect(end?.kind === "failed" ? translate("ko", end.why) : "").not.toContain(
      "provider_error",
    );
  });

  it("서버가 물린 말은 그 까닭으로 끝난다 (G6)", () => {
    const refused: ChatTurnState = {
      id: "t1",
      said: "안녕",
      runId: null,
      events: [],
      halted: { key: "chat.start.notPublished" },
    };

    expect(chatTurnEnd(graphTaking("message"), refused)).toEqual({
      kind: "failed",
      why: { key: "chat.start.notPublished" },
    });
  });

  it("도구 승인을 거절해도 그 뒤에 온 말이 답이다 — 밸브 거절과 다른 일이다 (M4)", () => {
    // 도구 노드도 node.completed에 approved를 적는다(거절이면 error 포트로 갈렸다는 표시일 뿐).
    // 그것을 밸브의 답으로 오인하면 실제로 온 답을 버리게 된다 (engine routed_runtime 주석).
    const withTool = {
      ...graphTaking("message"),
      nodes: [
        ...graphTaking("message").nodes,
        { id: "lookup", type: "tool.mcp", position: { x: 0, y: 0 }, config: {} },
      ],
    } as AgentSpec;
    const turned = turn("안녕", [
      event("run.paused", { waiting_for: "lookup" }, "lookup"),
      event("run.resumed", { waiting_for: "lookup", approved: false }, "lookup"),
      event("node.completed", { node_type: "tool.mcp", approved: false }, "lookup"),
      event("llm.completed", { text: "그 도구 없이 답할게요" }, "clinical-agent"),
      event("run.completed", {}),
    ]);

    expect(chatTurnEnd(withTool, turned)).toEqual({
      kind: "answer",
      text: "그 도구 없이 답할게요",
    });
  });

  it("사람이 거절한 말은 거절로 끝난다 (H2)", () => {
    const turned = turn("안녕", [
      event("run.paused", { waiting_for: "human-gate" }, "human-gate"),
      event("run.resumed", { waiting_for: "human-gate", approved: false }, "human-gate"),
      event("run.completed", {}),
    ]);

    expect(chatTurnEnd(graphTaking("message"), turned)).toEqual({ kind: "rejected" });
  });

  it("끝났는데 아무 말도 없었으면 그렇게 말한다 — 빈 말풍선을 세우지 않는다", () => {
    const silent = turn("안녕", [event("run.completed", {})]);

    expect(chatTurnEnd(graphTaking("message"), silent)).toEqual({ kind: "silent" });
  });
});

describe("어느 판과 이야기하는가 (G4)", () => {
  it("판 번호를 알면 번호로 말한다", () => {
    expect(translate("ko", chatPinWords({ revision: example.revision, version: 3 }))).toContain(
      "3",
    );
  });

  it("판 번호를 모르면 번호를 지어내지 않는다", () => {
    const words = translate("ko", chatPinWords({ revision: example.revision, version: null }));

    expect(words).not.toMatch(/\d/);
  });

  it("판을 가리키는 이름(revision) 원문은 화면 문구에 쓰지 않는다", () => {
    const words = translate("ko", chatPinWords({ revision: example.revision, version: 3 }));

    expect(words).not.toContain(example.revision);
  });
});
