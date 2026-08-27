import { describe, expect, it, vi } from "vitest";
import type { RunAnswerOutcome } from "../src/api/runs";
import { type GateAnswerCallbacks, answerGate } from "../src/run/gateAnswer";

const RUN_ID = "run_1";
const ANSWERED: RunAnswerOutcome = {
  run: { id: RUN_ID, spec_id: "spec_1", spec_revision: "sha256:test", created_at: "" },
  status: "running",
};

function callbacks(overrides: Partial<GateAnswerCallbacks> = {}): {
  callbacks: GateAnswerCallbacks;
  sent: unknown[];
  setAnswering: ReturnType<typeof vi.fn>;
  onFailure: ReturnType<typeof vi.fn>;
  onAnswered: ReturnType<typeof vi.fn>;
} {
  const sent: unknown[] = [];
  const setAnswering = vi.fn();
  const onFailure = vi.fn();
  const onAnswered = vi.fn();
  const base: GateAnswerCallbacks = {
    sendRunAnswer: async (_runId, answer) => {
      sent.push(answer);
      return ANSWERED;
    },
    isAwaitingGate: () => true,
    isAnswering: () => false,
    activeRunId: () => RUN_ID,
    setAnswering,
    onFailure,
    onAnswered,
    ...overrides,
  };
  return { callbacks: base, sent, setAnswering, onFailure, onAnswered };
}

describe("이미 답한 게이트 재전송 금지", () => {
  it("밸브 앞이 아니면 서버에 보내지 않는다", async () => {
    const { callbacks: cb, sent } = callbacks({ isAwaitingGate: () => false });

    await answerGate(true, undefined, cb);

    expect(sent).toEqual([]);
  });

  it("답을 기다리는 중이면 두 번 보내지 않는다", async () => {
    const { callbacks: cb, sent } = callbacks({ isAnswering: () => true });

    await answerGate(true, undefined, cb);

    expect(sent).toEqual([]);
  });

  it("볼 실행이 없으면 보내지 않는다", async () => {
    const { callbacks: cb, sent } = callbacks({ activeRunId: () => null });

    await answerGate(true, undefined, cb);

    expect(sent).toEqual([]);
  });
});

describe("페이로드 조립", () => {
  it("적어 넣은 값이 있으면 답과 함께 싣는다", async () => {
    const { callbacks: cb, sent } = callbacks();

    await answerGate(true, { comment: "checked" }, cb);

    expect(sent).toEqual([{ approved: true, values: { comment: "checked" } }]);
  });

  it("적어 넣은 것이 없으면 값 자리를 만들지 않는다", async () => {
    const { callbacks: cb, sent } = callbacks();

    await answerGate(false, undefined, cb);

    expect(sent).toEqual([{ approved: false }]);
  });
});

describe("실패 처리", () => {
  it("성공하면 재생을 다시 열고 실패를 말하지 않는다", async () => {
    const { callbacks: cb, onAnswered, onFailure, setAnswering } = callbacks();

    await answerGate(true, undefined, cb);

    expect(onAnswered).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    expect(setAnswering).toHaveBeenNthCalledWith(1, true);
    expect(setAnswering).toHaveBeenNthCalledWith(2, false);
  });

  it("서버가 답을 받지 못하면 실패를 말하고 재생을 열지 않는다", async () => {
    const failure = { key: "run.answer.offline" as const };
    const { callbacks: cb, onAnswered, onFailure } = callbacks({
      sendRunAnswer: async () => ({ failure }),
    });

    await answerGate(true, undefined, cb);

    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(onAnswered).not.toHaveBeenCalled();
  });
});
