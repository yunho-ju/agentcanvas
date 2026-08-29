import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import {
  type NodeRunStatus,
  edgeFlowStates,
  nodeRunFacts,
  toolFellShortIn,
  nodeStatesAt,
  offsetOf,
  runFinished,
  runLengthMs,
  seqAt,
  steppedSeq,
} from "../src/run/player";

const example = exampleSpec as unknown as AgentSpec;
// 예시 그래프는 사람 확인 밸브에서 한 번 멈춘다 — 되감기는 처음부터 끝까지의 실행을 본다.
// 밸브 앞에 멈춰 선 동안의 이야기는 gate-run/gate-store 테스트가 맡는다.
const options = {
  runId: "run_example",
  startedAt: new Date("2026-08-01T12:30:00.000Z"),
};
const events = resumeFakeRun(example, fakeRun(example, options), { approved: true });

function seqOfFirst(type: string, nodeId?: string): number {
  const found = events.find(
    (event) => event.event_type === type && (!nodeId || event.node_id === nodeId),
  );
  if (!found) throw new Error(`no ${type} event for ${nodeId ?? "the run"}`);
  return found.seq;
}

function stateOf(seq: number, nodeId: string): NodeRunStatus {
  return nodeStatesAt(events, seq)[nodeId] ?? "idle";
}

const lastSeq = events.at(-1)?.seq ?? 0;

describe("what each node is doing at a moment of the run", () => {
  it("has nobody working before the run reaches them", () => {
    expect(nodeStatesAt(events, seqOfFirst("run.started"))).toEqual({});
  });

  it("shows a node waiting for its turn", () => {
    expect(stateOf(seqOfFirst("node.queued", "triage"), "triage")).toBe("queued");
  });

  it("shows a node working once it starts", () => {
    expect(stateOf(seqOfFirst("node.started", "triage"), "triage")).toBe("running");
  });

  it("keeps a node working while it talks to the model", () => {
    expect(stateOf(seqOfFirst("llm.requested", "triage"), "triage")).toBe("running");
  });

  it("shows a node done once it finishes", () => {
    expect(stateOf(seqOfFirst("node.completed", "triage"), "triage")).toBe("completed");
  });

  it("leaves a node alone until the run gets to it", () => {
    expect(stateOf(seqOfFirst("node.completed", "input"), "output")).toBe("idle");
  });

  it("has every node done when the run is over", () => {
    expect(nodeStatesAt(events, lastSeq)).toEqual({
      input: "completed",
      triage: "completed",
      "clinical-agent": "completed",
      "human-gate": "completed",
      output: "completed",
    });
  });

  it("shows a node that could not finish as failed", () => {
    const failed: RunEvent[] = [
      ...events.slice(0, 3),
      { ...events[2], seq: 99, event_type: "node.failed" },
    ];
    expect(nodeStatesAt(failed, 99).input).toBe("failed");
  });

  // 서버 실행기는 갈림길에서 고른 길을 사건으로 남긴다 — 화면이 처음 보는 종류라도 흔들리지 않는다.
  it("is unbothered by a kind of event it has no picture for", () => {
    const decided: RunEvent[] = [
      ...events.slice(0, 3),
      {
        ...events[2],
        seq: 99,
        event_type: "decision.recorded",
        payload: { route: "clinical", ways: ["clinical", "simple"] },
      },
    ];

    expect(nodeStatesAt(decided, 99)).toEqual(nodeStatesAt(events, events[2].seq));
  });

  it("gives the same picture whether the moment was reached forwards or backwards", () => {
    const middle = seqOfFirst("node.started", "clinical-agent");
    const seqs = events.map((event) => event.seq);
    // 끝까지 갔다가 그 순간으로 되감아 온 길
    const wandered = [...seqs, ...[...seqs].reverse().filter((seq) => seq >= middle)];

    const afterWandering = wandered.reduce(
      (_, seq) => nodeStatesAt(events, seq),
      {} as Record<string, NodeRunStatus>,
    );

    expect(afterWandering).toEqual(nodeStatesAt(events, middle));
    expect(afterWandering).not.toEqual(nodeStatesAt(events, lastSeq));
  });
});

// 실행 중 카드가 말하는 핵심 숫자 하나와, 실패했을 때의 한 줄 (디자인 언어 §2.3).
describe("what a node has to show for its work", () => {
  it("says how long a finished node took", () => {
    const done = seqOfFirst("node.completed", "triage");
    const worked =
      Date.parse(events[done].timestamp) -
      Date.parse(events[seqOfFirst("node.started", "triage")].timestamp);

    expect(nodeRunFacts(events, done).triage.elapsedMs).toBe(worked);
  });

  it("has no number yet for a node still working", () => {
    const seq = seqOfFirst("node.started", "triage");
    expect(nodeRunFacts(events, seq).triage.elapsedMs).toBeUndefined();
  });

  it("carries the same status the canvas paints", () => {
    expect(nodeRunFacts(events, lastSeq).triage.status).toBe(
      nodeStatesAt(events, lastSeq).triage,
    );
  });

  it("keeps the reason a node could not finish", () => {
    const started = events[seqOfFirst("node.started", "input")];
    const failed: RunEvent[] = [
      ...events.slice(0, started.seq + 1),
      {
        ...started,
        seq: 99,
        event_type: "node.failed",
        payload: { error: "모델을 부를 수 없었다" },
      },
    ];

    expect(nodeRunFacts(failed, 99).input.error).toBe("모델을 부를 수 없었다");
  });

  it("says nothing about a failure that came without a reason", () => {
    const started = events[seqOfFirst("node.started", "input")];
    const failed: RunEvent[] = [
      ...events.slice(0, started.seq + 1),
      { ...started, seq: 99, event_type: "node.failed", payload: {} },
    ];

    expect(nodeRunFacts(failed, 99).input.error).toBeUndefined();
  });
});

describe("moving along the run in time", () => {
  it("starts counting from the first event", () => {
    expect(offsetOf(events, events[0].seq)).toBe(0);
  });

  it("measures a later event by how long after the start it happened", () => {
    expect(offsetOf(events, events[3].seq)).toBe(
      Date.parse(events[3].timestamp) - Date.parse(events[0].timestamp),
    );
  });

  it("is as long as the time up to its last event", () => {
    expect(runLengthMs(events)).toBe(offsetOf(events, lastSeq));
  });

  it("has no length when nothing happened", () => {
    expect(runLengthMs([])).toBe(0);
  });

  it("stays on an event until the next one is due", () => {
    const secondAt = offsetOf(events, events[1].seq);

    expect(seqAt(events, secondAt - 1)).toBe(events[0].seq);
    expect(seqAt(events, secondAt)).toBe(events[1].seq);
  });

  it("stops at the last event no matter how much time passes", () => {
    expect(seqAt(events, runLengthMs(events) * 10)).toBe(lastSeq);
  });

  it("sits on the first event before any time has passed", () => {
    expect(seqAt(events, -100)).toBe(events[0].seq);
  });
});

// 거절은 실패가 아니다 — 사람이 답했고, 그 답이 흐름을 여기서 마쳤다.
describe("a node the person turned down", () => {
  const refused = resumeFakeRun(example, fakeRun(example, options), { approved: false });
  const endSeq = refused.at(-1)?.seq ?? 0;

  it("is neither working nor failed — it was turned down", () => {
    expect(nodeStatesAt(refused, endSeq)["human-gate"]).toBe("rejected");
  });

  it("says nothing broke", () => {
    expect(nodeRunFacts(refused, endSeq)["human-gate"].error).toBeUndefined();
  });

  it("still tells how long the node was busy", () => {
    expect(nodeRunFacts(refused, endSeq)["human-gate"].elapsedMs).toBeGreaterThan(0);
  });

  it("leaves the nodes behind it not yet at their turn", () => {
    expect(nodeStatesAt(refused, endSeq).output).toBeUndefined();
  });

  it("hands nothing over to the nodes behind it", () => {
    const flows = edgeFlowStates(
      [{ id: "human-output", source: "human-gate", target: "output" }],
      refused,
      endSeq,
    );

    expect(flows["human-output"]).toBe("idle");
  });
});

describe("stepping one event at a time", () => {
  it("goes to the next event", () => {
    expect(steppedSeq(events, events[0].seq, 1)).toBe(events[1].seq);
  });

  it("goes back to the previous event", () => {
    expect(steppedSeq(events, events[2].seq, -1)).toBe(events[1].seq);
  });

  it("stays on the last event at the end of the run", () => {
    expect(steppedSeq(events, lastSeq, 1)).toBe(lastSeq);
  });

  it("stays on the first event at the beginning of the run", () => {
    expect(steppedSeq(events, events[0].seq, -1)).toBe(events[0].seq);
  });
});

// 처음 온 사람의 마지막 걸음("실행해 봐요")은 이 파생 하나를 본다 (DESIGN §7 first-steps-card).
describe("whether the run made it to the end", () => {
  it("has not finished while playing is still on the way", () => {
    expect(runFinished(events, seqOfFirst("node.started", "triage"))).toBe(false);
  });

  it("has finished once playing reaches the closing event", () => {
    expect(runFinished(events, lastSeq)).toBe(true);
  });

  it("has not finished while it waits for a person at the valve", () => {
    const held = fakeRun(example, options);

    expect(runFinished(held, held.at(-1)?.seq ?? 0)).toBe(false);
  });
});

// 도구가 일을 마치지 못한 노드는 마친 노드와 다르게 보인다 (API_TOOLS P3a).
// 그래프가 그 어그러짐을 다루더라도(error 포트) 사람에게는 초록불로 보이면 안 된다.
describe("a node whose tool could not finish", () => {
  function toolRun(ok: boolean): RunEvent[] {
    const started = events[seqOfFirst("node.started", "input")];
    return [
      ...events.slice(0, started.seq + 1),
      {
        ...started,
        seq: 90,
        event_type: "tool.completed",
        payload: ok
          ? { node_id: "input", ok: true, result: {}, original_chars: 2, loaded_chars: 2 }
          : {
              node_id: "input",
              ok: false,
              error: { reason: "timeout", message: "waited too long" },
            },
      },
      { ...started, seq: 91, event_type: "node.completed", payload: { node_type: "tool.mcp" } },
    ];
  }

  it("does not look like a node that finished its work", () => {
    expect(nodeRunFacts(toolRun(false), 91).input.status).toBe("toolFailed");
    expect(nodeRunFacts(toolRun(true), 91).input.status).toBe("completed");
  });

  it("still says how long it took — it did work, it just came up short", () => {
    expect(nodeRunFacts(toolRun(false), 91).input.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("goes back to green when the run is rewound past the trouble", () => {
    expect(nodeRunFacts(toolRun(false), 89).input.status).toBe("running");
  });

  it("the run as a whole knows a tool came up short", () => {
    expect(toolFellShortIn(toolRun(false))).toBe(true);
    expect(toolFellShortIn(toolRun(true))).toBe(false);
    expect(toolFellShortIn(events)).toBe(false);
  });
});

// 사람이 도구 실행을 멈춰 세운 노드는 초록불이 아니라 '멈춤'으로 보인다 (API_TOOLS P3b).
describe("사람이 멈춰 세운 도구 노드", () => {
  function rejectedTool(): RunEvent[] {
    const started = events[seqOfFirst("node.started", "input")];
    return [
      ...events.slice(0, started.seq + 1),
      { ...started, seq: 92, event_type: "human.approval_requested", payload: { node_id: "input", tool_name: "charge_card" } },
      { ...started, seq: 93, event_type: "run.paused", payload: { waiting_for: "input" } },
      { ...started, seq: 94, event_type: "run.resumed", payload: { waiting_for: "input", approved: false } },
      { ...started, seq: 95, event_type: "node.completed", payload: { node_type: "tool.mcp", approved: false } },
    ];
  }

  it("마친 것도 실패한 것도 아닌 '멈춤' 결말로 보인다 — 초록불이 아니다", () => {
    const status = nodeRunFacts(rejectedTool(), 95).input.status;
    expect(status).toBe("rejected");
    expect(status).not.toBe("completed");
  });
});
