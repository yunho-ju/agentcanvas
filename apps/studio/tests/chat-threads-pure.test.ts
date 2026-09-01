// 지난 대화를 다시 읽는 규칙 — 쌓인 이벤트에서 오간 말을 되짓고(K1), 목록 한 줄을 말로 옮긴다(J1·J3).
// 새 판정은 없다: 사람의 말은 실행이 열릴 때 실린 값에서, 끝은 실시간 대화와 같은 순수 함수에서 나온다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { ThreadSummary, ThreadTurn } from "../src/api/threads";
import { chatTurnEnd } from "../src/chat/chatTurn";
import {
  restoredTurns,
  runningElsewhere,
  versionOfRevision,
} from "../src/chat/threadHistory";
import { threadCaption, threadTitle } from "../src/chat/threadWords";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";

const example = exampleSpec as unknown as AgentSpec;

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

let seq = 0;

function event(
  event_type: RunEvent["event_type"],
  payload: Record<string, unknown> = {},
  nodeId?: string,
  runId = "run_1",
): RunEvent {
  seq += 1;
  return {
    event_type,
    payload,
    run_id: runId,
    seq,
    spec_revision: example.revision,
    timestamp: "2026-08-01T12:30:00Z",
    ...(nodeId ? { node_id: nodeId } : {}),
  };
}

function turn(runId: string, events: RunEvent[]): ThreadTurn {
  return {
    run: {
      id: runId,
      spec_id: example.id,
      spec_revision: example.revision,
      created_at: "2026-08-01T12:30:00Z",
      thread_id: "run_1",
    },
    events,
  };
}

function summary(known: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    thread_id: "run_1",
    first_said: "안녕",
    started_at: "2026-08-01T12:30:00Z",
    last_at: "2026-08-01T12:40:00Z",
    turns: 2,
    last_status: "completed",
    spec_revision: example.revision,
    ...known,
  };
}

describe("쌓인 이벤트에서 오간 말을 되짓는다 (K1)", () => {
  it("사람이 한 말은 그 실행이 열릴 때 실린 값에서 온다", () => {
    const restored = restoredTurns([
      turn("run_1", [
        event("run.started", { input: { message: "안녕" } }),
        event("llm.completed", { text: "반가워요" }, "clinical-agent"),
        event("run.completed", {}),
      ]),
    ]);

    expect(restored).toHaveLength(1);
    expect(restored[0].said).toBe("안녕");
    expect(restored[0].runId).toBe("run_1");
  });

  it("되지은 말의 끝은 실시간 대화와 같은 답이다 — 판정을 두 벌로 만들지 않는다", () => {
    const restored = restoredTurns([
      turn("run_1", [
        event("run.started", { input: { message: "안녕" } }),
        event("llm.completed", { text: "반가워요" }, "clinical-agent"),
        event("run.completed", {}),
      ]),
    ]);

    expect(chatTurnEnd(graphTaking("message"), restored[0])).toEqual({
      kind: "answer",
      text: "반가워요",
    });
  });

  it("사람의 말 없이 시작한 실행은 말을 지어내지 않는다", () => {
    const restored = restoredTurns([
      turn("run_1", [event("run.started", { input: { question: "무엇" } })]),
    ]);

    expect(restored[0].said).toBe("");
  });

  it("여러 말이 오간 대화는 오간 순서대로 선다", () => {
    const restored = restoredTurns([
      turn("run_1", [event("run.started", { input: { message: "안녕" } })]),
      turn("run_2", [event("run.started", { input: { message: "잘 지내?" } }, undefined, "run_2")]),
    ]);

    expect(restored.map((one) => one.said)).toEqual(["안녕", "잘 지내?"]);
    expect(restored.map((one) => one.id)).toEqual(["run_1", "run_2"]);
  });
});

describe("복원한 대화가 지금 어떤가 (G5류)", () => {
  const spec = graphTaking("message");

  it("아직 돌고 있는 말이 남아 있으면 그렇다고 말한다", () => {
    const going = restoredTurns([
      turn("run_1", [event("run.started", { input: { message: "안녕" } })]),
    ]);

    expect(runningElsewhere(spec, going)).toBe(true);
  });

  it("확인을 기다리며 멈춘 대화는 진행 중이 아니다 — 승인 카드가 답을 기다린다 (K3)", () => {
    const held = restoredTurns([
      turn("run_1", [
        event("run.started", { input: { message: "안녕" } }),
        event("human.approval_requested", {}, "human-gate"),
        event("run.paused", { waiting_for: "human-gate" }, "human-gate"),
      ]),
    ]);

    expect(runningElsewhere(spec, held)).toBe(false);
  });

  it("끝난 대화는 진행 중이 아니다", () => {
    const done = restoredTurns([
      turn("run_1", [
        event("run.started", { input: { message: "안녕" } }),
        event("run.completed", {}),
      ]),
    ]);

    expect(runningElsewhere(spec, done)).toBe(false);
  });
});

describe("복원한 대화가 붙잡는 판의 번호 (결정 3)", () => {
  const revisions = [
    { version: 2, revision: example.revision, created_at: "2026-08-01T12:00:00Z" },
    { version: 1, revision: `sha256:${"b".repeat(64)}`, created_at: "2026-07-01T12:00:00Z" },
  ];

  it("판 기록에서 그 판의 순번을 찾는다", () => {
    expect(versionOfRevision(revisions, example.revision)).toBe(2);
  });

  it("찾지 못하면 번호를 지어내지 않는다", () => {
    expect(versionOfRevision(revisions, `sha256:${"c".repeat(64)}`)).toBeNull();
  });
});

describe("목록 한 줄이 말하는 것 (J1·J3)", () => {
  it("제목은 그 대화의 첫 말이다", () => {
    expect(threadTitle(summary(), "ko")).toBe("안녕");
  });

  it("첫 말이 없으면 자리표시로 말한다 — 숨기지 않는다 (J3)", () => {
    const title = threadTitle(summary({ first_said: null }), "ko");

    expect(title).not.toBe("");
    expect(title).toContain("말 없이");
  });

  it("첫 말이 빈 칸뿐이어도 빈 제목을 세우지 않는다 (J3)", () => {
    expect(threadTitle(summary({ first_said: "   " }), "ko")).toContain("말 없이");
  });

  it("캡션은 마지막 시각·오간 횟수·마지막 상태를 말한다", () => {
    const caption = threadCaption(summary({ turns: 3 }), "ko");

    expect(caption).toContain("3번");
    expect(caption).toContain("끝난 대화");
  });

  it("마지막 상태는 서버 이름이 아니라 쉬운 말이다 (§9)", () => {
    for (const status of ["running", "paused", "completed", "failed"] as const) {
      const caption = threadCaption(summary({ last_status: status }), "ko");

      expect(caption).not.toContain(status);
    }
  });

  it("확인을 기다리는 대화와 끝난 대화는 다른 말이다", () => {
    expect(threadCaption(summary({ last_status: "paused" }), "ko")).toContain("확인");
    expect(threadCaption(summary({ last_status: "failed" }), "ko")).toContain("멈춘");
  });

  it("영어로도 빈 말이 되지 않는다", () => {
    expect(threadCaption(summary(), "en")).not.toBe("");
    expect(threadTitle(summary({ first_said: null }), "en")).not.toBe("");
  });
});
