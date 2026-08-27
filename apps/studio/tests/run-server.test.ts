// 실행은 서버의 것이다 — 화면은 실행을 부탁하고, 서버가 흘려보내는 이벤트를 받아 쌓는다.
// 서버에 닿지 못하면 실행하지 않는다: 반쪽 실행(승인을 서버에 보내지 못하는 실행)을 만들지 않는다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { type RunStartOutcome, startRunOnServer } from "../src/api/runs";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { type Message, msg, translate } from "../src/i18n/messages";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import { awaitingGate, currentSeq } from "../src/store/runSlice";
import { type RunServerDouble, serveRuns, settle } from "./fakeRunServer";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;
const REVISION = `sha256:${"b".repeat(64)}`;
const RUN_ID = "run_from_server";
const STARTED_AT = new Date("2026-08-01T12:30:00.000Z");

function store() {
  return useEditor.getState();
}

/** 재생이 저절로 멈출 때까지 흘려 보낸다. */
function playOn() {
  store().tickRun(EVENT_STEP_MS * 1000);
}

function said(message: Message | null): string {
  return message ? translate("ko", message) : "";
}

async function startRun(): Promise<void> {
  await store().startRun(REVISION);
  await settle();
}

beforeEach(() => {
  useEditor.setState({
    runEvents: [],
    runHistory: [],
    activeRunId: null,
    savedSpec: null,
    feedbackNotice: null,
    saving: false,
    startingRun: false,
  });
  store().loadSpec(example);
});

describe("서버에 실행을 부탁하는 일", () => {
  it("어느 그래프의 어느 판을 돌릴지 적어 보낸다", async () => {
    const asked: string[][] = [];
    useEditor.setState({
      sendRunStart: async (specId, revision) => {
        asked.push([specId, revision]);
        return { failure: msg("run.start.offline") };
      },
    });

    await startRun();

    expect(asked).toEqual([[example.id, REVISION]]);
  });

  it("실행의 이름과 시각은 서버가 매긴 것이다 — 화면이 짓지 않는다", async () => {
    serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });

    await startRun();

    expect(store().activeRunId).toBe(RUN_ID);
    expect(store().runHistory).toHaveLength(1);
    expect(store().runHistory[0].at.toISOString()).toBe(STARTED_AT.toISOString());
  });

  it("흘러온 이벤트가 화면과 기록에 함께 쌓인다", async () => {
    serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });

    await startRun();

    expect(store().runEvents.length).toBeGreaterThan(0);
    expect(store().runEvents.at(-1)?.event_type).toBe("run.paused");
    expect(store().runHistory[0].events).toEqual(store().runEvents);
  });

  it("멈춰 선 자리에서 확인 카드가 열린다", async () => {
    serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();

    playOn();

    expect(awaitingGate(store())).toBe("human-gate");
    expect(store().gateCardOpen).toBe(true);
  });
});

describe("사람의 답도 서버가 받는다", () => {
  let server: RunServerDouble;

  beforeEach(async () => {
    server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    playOn();
  });

  it("승인하면 이어진 이벤트가 스트림으로 도착해 끝까지 간다", async () => {
    await store().approveGate();
    await settle();

    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
    expect(store().gateCardOpen).toBe(false);
    expect(store().isPlaying).toBe(true);
  });

  it("적어 넣은 값을 답과 함께 서버에 보낸다", async () => {
    await store().approveGate({ comment: "checked it myself" });
    await settle();

    const resumed = store().runEvents.find(
      (event) => event.event_type === "run.resumed",
    );
    expect(resumed?.payload.values).toEqual({ comment: "checked it myself" });
  });

  it("실행이 닫히면 이벤트 받기도 끝난다 — 붙잡고 있지 않는다", async () => {
    expect(server.open).toBe(1);

    await store().approveGate();
    await settle();

    expect(server.open).toBe(0);
  });

  it("답이 오가는 사이에 다시 눌러도 답은 한 번만 간다", async () => {
    let release = () => {};
    const asked: boolean[] = [];
    useEditor.setState({
      sendRunAnswer: async (_runId, given) => {
        asked.push(given.approved);
        return new Promise((resolve) => {
          release = () => resolve({ failure: msg("run.answer.offline") });
        });
      },
    });

    const first = store().approveGate();
    const second = store().approveGate();
    release();
    await Promise.all([first, second]);

    expect(asked).toEqual([true]);
  });

  it("답이 오가는 동안에는 거절도 끼어들지 못한다", async () => {
    let release = () => {};
    const asked: boolean[] = [];
    useEditor.setState({
      sendRunAnswer: async (_runId, given) => {
        asked.push(given.approved);
        return new Promise((resolve) => {
          release = () => resolve({ failure: msg("run.answer.offline") });
        });
      },
    });

    const first = store().approveGate();
    const second = store().rejectGate();
    release();
    await Promise.all([first, second]);

    expect(asked).toEqual([true]);
  });

  it("답이 오간 뒤에는 다시 답할 수 있다 — 잠금이 풀린다", async () => {
    useEditor.setState({
      sendRunAnswer: async () => ({ failure: msg("run.answer.offline") }),
    });

    await store().approveGate();

    expect(store().answeringGate).toBe(false);
  });

  it("서버가 답을 받지 못하면 카드를 닫지 않고 까닭을 말한다", async () => {
    useEditor.setState({
      sendRunAnswer: async () => ({ failure: msg("run.answer.moved") }),
    });

    await store().approveGate();

    expect(store().gateCardOpen).toBe(true);
    expect(store().feedbackNotice?.tone).toBe("warn");
    expect(said(store().feedbackNotice?.message ?? null)).toContain("답");
  });
});

// 재생하겠다는 뜻(isPlaying)은 사람의 것이다 — 시계가 그것을 끄는 순간은 실행이 닫히는 데까지
// 재생을 마쳤을 때 하나뿐이다. 아직 닫히지 않은 실행의 끝에 닿은 것은 "도착을 기다리는 중"이다.
describe("이벤트가 아직 오는 중일 때의 재생", () => {
  it("승인한 뒤 이벤트가 닿기 전에 시계가 흘러도 재생을 끄지 않는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    playOn();
    server.hold();
    await store().approveGate();
    await settle();

    store().tickRun(EVENT_STEP_MS);

    expect(store().runEvents.at(-1)?.event_type).toBe("run.paused");
    expect(store().isPlaying).toBe(true);
  });

  it("기다리던 이벤트가 닿으면 재생이 저절로 이어져 끝까지 간다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    playOn();
    server.hold();
    await store().approveGate();
    await settle();
    store().tickRun(EVENT_STEP_MS);

    server.flow();
    await settle();
    store().tickRun(EVENT_STEP_MS * 1000);

    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
  });

  it("실행이 닫히는 데까지 재생하면 그때 재생이 멈춘다", async () => {
    serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    playOn();
    await store().approveGate();
    await settle();

    store().tickRun(EVENT_STEP_MS * 1000);

    expect(store().isPlaying).toBe(false);
  });

  it("시작한 실행의 이벤트가 몇 개만 닿은 사이에도 재생은 서 있다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    server.hold();
    await startRun();
    server.flow(1);
    await settle();
    expect(store().runEvents).toHaveLength(1);

    store().tickRun(EVENT_STEP_MS);

    expect(store().isPlaying).toBe(true);
  });

  it("나머지 이벤트가 닿으면 멈춰 선 밸브까지 이어 재생한다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    server.hold();
    await startRun();
    server.flow(1);
    await settle();
    store().tickRun(EVENT_STEP_MS);

    server.flow();
    await settle();
    store().tickRun(EVENT_STEP_MS * 1000);

    expect(awaitingGate(store())).toBe("human-gate");
    expect(store().gateCardOpen).toBe(true);
  });
});

describe("실행하지 못했을 때", () => {
  it("저장하지 못하면 서버에 실행을 부탁하지도 않는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    useEditor.setState({ sendSpec: async () => ({ failure: msg("save.offline") }) });

    await store().saveThenRun();
    await settle();

    expect(server.starts).toBe(0);
    expect(store().runHistory).toEqual([]);
    expect(store().runEvents).toEqual([]);
    expect(said(store().feedbackNotice?.message ?? null)).toContain("저장");
    expect(store().feedbackNotice?.tone).toBe("warn");
  });

  it("저장한 뒤에는 서버가 매긴 판으로 실행을 부탁한다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    useEditor.setState({
      sendSpec: async (spec) => ({
        saved: asServerAnswer({ ...spec, version: 4, revision: REVISION }),
        issues: [],
      }),
    });

    await store().saveThenRun();
    await settle();

    expect(server.starts).toBe(1);
    expect(store().runHistory[0].events[0].spec_revision).toBe(REVISION);
  });

  it("서버에 닿지 못하면 기록도 남지 않고 까닭이 남는다", async () => {
    const offline: RunStartOutcome = { failure: msg("run.start.offline") };
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    server.refuse(offline);

    await startRun();

    expect(store().runHistory).toEqual([]);
    expect(store().activeRunId).toBeNull();
    expect(said(store().feedbackNotice?.message ?? null)).toBe(said(offline.failure ?? null));
  });

  it("서버가 물린 까닭을 그대로 옮긴다 — 판이 어긋난 것과 닿지 못한 것은 다른 말이다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    server.refuse({ failure: msg("run.start.moved") });

    await startRun();

    expect(said(store().feedbackNotice?.message ?? null)).toContain("달라졌");
  });

  it("이벤트가 오기 전에는 시계가 재생을 멈춰 세우지 않는다", async () => {
    let release = () => {};
    useEditor.setState({
      sendRunStart: async () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              run: {
                id: RUN_ID,
                spec_id: example.id,
                spec_revision: REVISION,
                created_at: STARTED_AT.toISOString(),
              },
              status: "running",
            });
        }),
      watchRunEvents: async () => ({ ended: false, lastSeq: null }),
    });

    const running = store().startRun(REVISION);
    release();
    await running;
    playOn();

    expect(store().isPlaying).toBe(true);
  });
});

describe("서버의 대답을 기다리는 사이", () => {
  /** 손으로 놓아 줄 때까지 실행을 열어 주지 않는 서버. */
  function slowServer() {
    let release = () => {};
    const asked: string[] = [];
    useEditor.setState({
      sendRunStart: async (specId) => {
        asked.push(specId);
        return new Promise<RunStartOutcome>((resolve) => {
          release = () => resolve({ failure: msg("run.start.offline") });
        });
      },
    });
    return { asked, answer: () => release() };
  }

  it("실행 버튼을 다시 눌러도 두 번째 실행을 만들지 않는다", async () => {
    const server = slowServer();

    const first = store().startRun(REVISION);
    const second = store().startRun(REVISION);
    server.answer();
    await Promise.all([first, second]);

    expect(server.asked).toHaveLength(1);
  });

  // 잠금은 반드시 풀린다 — 대답하지 않는 서버 하나가 실행 버튼을 영영 잠그게 두지 않는다.
  it("대답 없는 부탁이 시한을 넘기면 실행 버튼의 잠금이 풀린다", async () => {
    useEditor.setState({
      sendRunStart: (specId, revision) =>
        startRunOnServer(specId, revision, undefined, {
          fetch: () => new Promise<never>(() => {}),
          deadline: AbortSignal.abort(),
        }),
    });

    await store().startRun(REVISION);

    expect(store().startingRun).toBe(false);
    expect(said(store().feedbackNotice?.message ?? null)).toContain("서버");
  });

  it("대답을 기다리는 사이에 다른 문서를 열면 늦게 온 대답은 못 들은 것으로 한다", async () => {
    let release = () => {};
    useEditor.setState({
      sendRunStart: async () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              run: {
                id: RUN_ID,
                spec_id: example.id,
                spec_revision: REVISION,
                created_at: STARTED_AT.toISOString(),
              },
              status: "running",
            });
        }),
    });

    const running = store().startRun(REVISION);
    store().loadSpec({ ...example, id: "another-agent" });
    release();
    await running;
    await settle();

    expect(store().runHistory).toEqual([]);
    expect(store().activeRunId).toBeNull();
    expect(store().startingRun).toBe(false);
  });

  it("실행을 부탁해 둔 동안에는 저장하고 실행하기도 새로 시작하지 않는다", async () => {
    const server = slowServer();

    const first = store().startRun(REVISION);
    await store().saveThenRun();
    server.answer();
    await first;

    expect(server.asked).toHaveLength(1);
  });
});

// 버린 스트림을 서버에 매달아 두지 않는다 — 밸브 앞에 멈춘 실행의 스트림은 저절로 닫히지 않는다.
describe("더 듣지 않기로 했을 때", () => {
  it("실행 보기를 닫으면 이벤트 받기도 그만둔다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    expect(server.open).toBe(1);

    store().stopRun();
    await settle();

    expect(server.cancelled).toBe(1);
    expect(server.open).toBe(0);
  });

  it("그만 듣기로 한 스트림은 다시 잇지 않고, 끊겼다고 말하지도 않는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();

    store().stopRun();
    await settle();

    expect(server.streams).toBe(1);
    expect(store().feedbackNotice).toBeNull();
  });

  it("다른 문서를 열면 그 실행의 이벤트도 더 듣지 않는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();

    store().loadSpec({ ...example, id: "another-agent" });
    await settle();

    expect(server.cancelled).toBe(1);
    expect(server.open).toBe(0);
  });

  it("새 실행을 열면 앞선 실행의 스트림은 남지 않는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    store().stopRun();
    await settle();

    await startRun();

    expect(server.open).toBe(1);
  });
});

describe("이벤트가 끊겼다 이어질 때", () => {
  it("읽던 자리부터 한 번 더 이어 받는다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
    const heard = store().runEvents.length;

    server.cut();
    await settle();

    expect(server.streams).toBe(2);
    expect(store().runEvents).toHaveLength(heard);
  });

  // 더 올 이벤트가 없다는 것을 알게 된 순간에는 기다림도 끝낸다 — 빈 시계를 돌리지 않는다.
  it("소식이 끊기면 도착을 기다리던 재생도 멈춰 선다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();

    server.cut();
    await settle();
    server.cut();
    await settle();

    expect(store().isPlaying).toBe(false);
  });

  it("지난 실행을 다시 보는 중이면 끊긴 소식이 그 재생을 멈추지 않는다", async () => {
    serveRuns({ runId: "run_one", startedAt: STARTED_AT });
    await startRun();
    store().stopRun();
    await settle();
    const later = serveRuns({ runId: "run_two", startedAt: STARTED_AT });
    await startRun();
    store().replayRun("run_one");

    later.cut();
    await settle();
    later.cut();
    await settle();

    expect(store().activeRunId).toBe("run_one");
    expect(store().isPlaying).toBe(true);
  });

  it("두 번째도 끊기면 소식이 끊겼다고 말한다", async () => {
    const server = serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();

    server.cut();
    await settle();
    server.cut();
    await settle();

    expect(server.streams).toBe(2);
    expect(said(store().feedbackNotice?.message ?? null)).toBe(said(msg("run.stream.lost")));
  });
});

describe("이미 들은 이벤트가 또 왔을 때", () => {
  function eventAt(seq: number): RunEvent {
    return {
      seq,
      run_id: RUN_ID,
      event_type: "node.queued",
      timestamp: new Date(STARTED_AT.getTime() + seq * EVENT_STEP_MS).toISOString(),
      spec_revision: REVISION,
      payload: {},
    };
  }

  beforeEach(async () => {
    serveRuns({ runId: RUN_ID, startedAt: STARTED_AT });
    await startRun();
  });

  it("같은 순번은 두 번 쌓이지 않는다", () => {
    const heard = store().runEvents.length;

    store().appendRunEvents(RUN_ID, store().runEvents.slice(0, 3));

    expect(store().runEvents).toHaveLength(heard);
  });

  it("늦게 온 이벤트도 순번 순서로 앉는다", () => {
    const last = store().runEvents.at(-1)!.seq;

    store().appendRunEvents(RUN_ID, [eventAt(last + 2), eventAt(last + 1)]);

    expect(store().runEvents.map((event) => event.seq)).toEqual(
      [...store().runEvents.map((event) => event.seq)].sort((a, b) => a - b),
    );
    expect(store().runEvents.at(-1)?.seq).toBe(last + 2);
  });

  it("모르는 실행의 이벤트는 받지 않는다", () => {
    const heard = store().runEvents;

    store().appendRunEvents("someone-elses-run", [eventAt(99)]);

    expect(store().runEvents).toEqual(heard);
  });
});
