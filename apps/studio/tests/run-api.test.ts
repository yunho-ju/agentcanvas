// 실행을 서버에 부탁하는 문 — 여기서만 서버와 말한다. 시험은 가짜 서버를 꽂아 넣는다.
// 진짜 fetch의 몸통 스트림(ReadableStream)을 읽는 자리는 jsdom이 덮지 못한다 —
// 그 자리(기본 open)는 메인이 실서버+실브라우저로 실증한다. 여기서는 주입 계약만 고정한다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import {
  type StreamResponse,
  answerGateOnServer,
  startRunOnServer,
  streamRunEvents,
} from "../src/api/runs";
import type { RunEvent } from "../src/generated/run_event";
import { translate } from "../src/i18n/messages";

const REVISION = `sha256:${"a".repeat(64)}`;

const run = {
  id: "abc123",
  spec_id: "clinical-assistant",
  spec_revision: REVISION,
  created_at: "2026-08-01T12:30:00Z",
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** 서버 대신 대답하는 사람 — 무엇을 물었는지 받아 적는다. */
function server(reply: { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body ?? "null") });
    return {
      status: reply.status,
      json: async () => reply.body ?? {},
    } satisfies HttpResponse;
  };
  return { calls, fetch };
}

const asleep = async () => {
  throw new TypeError("Failed to fetch");
};

describe("서버에 실행을 부탁하는 일", () => {
  it("어느 판을 돌릴지 적어 보내고 서버가 발급한 실행을 들고 온다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "paused" } });

    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls).toEqual([
      {
        url: "http://here/specs/clinical-assistant/runs",
        method: "POST",
        body: { spec_revision: REVISION },
      },
    ]);
    expect(outcome.run).toEqual(run);
    expect(outcome.status).toBe("paused");
  });

  it("사람이 넣은 값을 실행과 함께 적어 보낸다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "paused" } });

    await startRunOnServer(
      "clinical-assistant",
      REVISION,
      { question: "무엇을 볼까" },
      { baseUrl: "http://here", fetch },
    );

    expect(calls[0].body).toEqual({
      spec_revision: REVISION,
      input: { question: "무엇을 볼까" },
    });
  });

  it("넣은 값이 없으면 값 자리를 아예 만들지 않는다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "paused" } });

    await startRunOnServer("clinical-assistant", REVISION, {}, { fetch });

    expect(calls[0].body).toEqual({ spec_revision: REVISION });
  });

  it("서버에 닿지 못하면 그 사실을 쉬운 말로 돌려준다 — 던지지 않는다", async () => {
    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch: asleep,
    });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
    expect(translate("en", outcome.failure!)).not.toBe("");
  });

  it("서버가 모르는 그래프면 먼저 저장하라고 말한다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no graph" } });

    const outcome = await startRunOnServer("nowhere", REVISION, undefined, { fetch });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("저장");
  });

  it("돌리려던 판이 서버의 판과 다르면 판이 어긋났다고 말한다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "has moved on" } });

    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch,
    });

    expect(outcome.run).toBeUndefined();
    const said = translate("ko", outcome.failure!);
    expect(said).toContain("달라졌");
    expect(said).not.toContain("has moved on");
  });

  it("실행이 실려 오지 않은 답은 실행으로 삼지 않는다", async () => {
    const { fetch } = server({ status: 201, body: { status: "running" } });

    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch,
    });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).not.toBe("");
  });

  // 아무 말도 하지 않는 서버는 닿지 못한 서버와 같다 — 영원히 기다리면 실행 버튼이 영영 잠긴다.
  it("서버가 시한까지 아무 말도 하지 않으면 닿지 못한 것으로 한다", async () => {
    const never = () => new Promise<never>(() => {});

    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch: never,
      deadline: AbortSignal.abort(),
    });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
  });

  it("따로 정해 주지 않아도 시한을 들고 서버에 간다 — 소켓을 매달아 두지 않는다", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetch = async (_url: string, init: { signal?: AbortSignal }) => {
      signals.push(init.signal);
      return { status: 201, json: async () => ({ run, status: "paused" }) };
    };

    await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch,
    });

    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });

  it("생각지 못한 대답에도 무너지지 않는다", async () => {
    const { fetch } = server({ status: 500, body: {} });

    const outcome = await startRunOnServer("clinical-assistant", REVISION, undefined, {
      fetch,
    });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("500");
  });
});

describe("멈춰 선 실행에 사람의 답을 보내는 일", () => {
  it("적어 넣은 값까지 그대로 보낸다", async () => {
    const { calls, fetch } = server({ status: 200, body: { run, status: "completed" } });

    const outcome = await answerGateOnServer(
      "abc123",
      { approved: true, values: { comment: "ok" } },
      { baseUrl: "http://here", fetch },
    );

    expect(calls).toEqual([
      {
        url: "http://here/runs/abc123/approval",
        method: "POST",
        body: { approved: true, values: { comment: "ok" } },
      },
    ]);
    expect(outcome.run).toEqual(run);
  });

  it("이미 답이 처리된 실행이면 그렇게 말한다 — 없는 행동을 시키지 않는다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "not waiting" } });

    const outcome = await answerGateOnServer("abc123", { approved: true }, { fetch });

    expect(outcome.run).toBeUndefined();
    const said = translate("ko", outcome.failure!);
    expect(said).toContain("답");
    expect(said).not.toContain("not waiting");
    // 화면에 없는 행동("실행을 다시 열기")을 하라고 하지 않는다 — 사실만 말한다.
    expect(said).not.toContain("다시 열어");
    expect(translate("en", outcome.failure!)).not.toContain("open the run again");
  });

  it("서버가 모르는 실행이면 그렇게 말한다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no run" } });

    const outcome = await answerGateOnServer("gone", { approved: true }, { fetch });

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).not.toBe("");
  });

  it("받았다는 답을 읽을 수 없으면 답이 갔다고 하지 않는다", async () => {
    const { fetch } = server({ status: 200, body: { status: "running" } });

    const outcome = await answerGateOnServer("abc123", { approved: true }, { fetch });

    expect(outcome.run).toBeUndefined();
    const said = translate("ko", outcome.failure!);
    expect(said).toContain("답");
    expect(said).not.toContain("다시 실행해");
  });

  it("서버가 시한까지 아무 말도 하지 않으면 닿지 못한 것으로 한다", async () => {
    const never = () => new Promise<never>(() => {});

    const outcome = await answerGateOnServer(
      "abc123",
      { approved: true },
      { fetch: never, deadline: AbortSignal.abort() },
    );

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
  });

  it("서버에 닿지 못하면 그 사실을 쉬운 말로 돌려준다 — 던지지 않는다", async () => {
    const outcome = await answerGateOnServer(
      "abc123",
      { approved: false },
      { fetch: asleep },
    );

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
  });
});

function frame(event: Record<string, unknown>): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 서버가 남긴 이벤트 하나 — 서버는 node_id를 비워서라도 적고, 시각에 마이크로초까지 적는다. */
function serverEvent(seq: number, eventType: string, nodeId: string | null = null) {
  return {
    seq,
    run_id: "abc123",
    event_type: eventType,
    node_id: nodeId,
    timestamp: `2026-08-01T12:30:0${seq}.123456Z`,
    spec_revision: REVISION,
    payload: {},
  };
}

/** 청크를 이 순서대로 흘려보내는 서버. 다 흘리면 스트림이 닫힌다. */
function streaming(...chunks: string[]) {
  const asked: string[] = [];
  const open = async (url: string) => {
    asked.push(url);
    return {
      status: 200,
      chunks: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    } satisfies StreamResponse;
  };
  return { asked, open };
}

function watching() {
  const events: RunEvent[] = [];
  return { events, onEvent: (event: RunEvent) => events.push(event) };
}

describe("실행이 남기는 이벤트를 받아 보는 일", () => {
  it("흘러오는 이벤트를 순서대로 넘겨주고 실행이 닫히면 정상 종료한다", async () => {
    const { asked, open } = streaming(
      frame(serverEvent(0, "run.started")),
      frame(serverEvent(1, "node.started", "triage")),
      frame(serverEvent(2, "run.completed")),
    );
    const seen = watching();

    const end = await streamRunEvents("abc123", {
      onEvent: seen.onEvent,
      baseUrl: "http://here",
      open,
    });

    expect(asked).toEqual(["http://here/runs/abc123/events"]);
    expect(seen.events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(end).toEqual({ ended: true, lastSeq: 2 });
  });

  it("서버가 적은 그대로 이벤트를 넘긴다 — 글자로 견주지 않는다", async () => {
    const { open } = streaming(frame(serverEvent(0, "run.started")));
    const seen = watching();

    await streamRunEvents("abc123", { onEvent: seen.onEvent, open });

    expect(seen.events[0]).toEqual({
      seq: 0,
      run_id: "abc123",
      event_type: "run.started",
      node_id: null,
      timestamp: "2026-08-01T12:30:00.123456Z",
      spec_revision: REVISION,
      payload: {},
    });
  });

  it("읽던 자리부터 이어 받겠다고 적어 물어본다", async () => {
    const { asked, open } = streaming(frame(serverEvent(4, "run.completed")));

    await streamRunEvents("abc123", { after: 3, onEvent: () => {}, open });

    expect(asked).toEqual(["http://localhost:8000/runs/abc123/events?after=3"]);
  });

  it("토막 중간에서 끊겨 온 청크도 이어 붙여 이벤트 하나로 읽는다", async () => {
    const whole = frame(serverEvent(0, "run.completed"));
    const { open } = streaming(whole.slice(0, 12), whole.slice(12));
    const seen = watching();

    const end = await streamRunEvents("abc123", { onEvent: seen.onEvent, open });

    expect(seen.events).toHaveLength(1);
    expect(end.ended).toBe(true);
  });

  it("실행이 닫히기 전에 끊기면 어디까지 들었는지 말한다", async () => {
    const { open } = streaming(
      frame(serverEvent(0, "run.started")),
      frame(serverEvent(1, "run.paused")),
    );
    const seen = watching();

    const end = await streamRunEvents("abc123", { onEvent: seen.onEvent, open });

    expect(seen.events).toHaveLength(2);
    expect(end.ended).toBe(false);
    expect(end.lastSeq).toBe(1);
  });

  it("아무것도 듣지 못하고 끊기면 물어본 자리를 그대로 들고 온다", async () => {
    const { open } = streaming(": keepalive\n\n");

    const end = await streamRunEvents("abc123", { after: 7, onEvent: () => {}, open });

    expect(end).toEqual({ ended: false, lastSeq: 7 });
  });

  it("순번도 종류도 없는 토막은 이벤트로 삼지 않는다", async () => {
    const { open } = streaming(
      "data: not json at all\n\n",
      'data: {"hello":"there"}\n\n',
      frame(serverEvent(0, "run.completed")),
    );
    const seen = watching();

    await streamRunEvents("abc123", { onEvent: seen.onEvent, open });

    expect(seen.events.map((event) => event.event_type)).toEqual(["run.completed"]);
  });

  it("그만 듣겠다는 뜻을 스트림을 여는 자리에 그대로 건넨다", async () => {
    const stop = new AbortController();
    const handed: (AbortSignal | undefined)[] = [];
    const open = async (_url: string, init: { signal?: AbortSignal }) => {
      handed.push(init.signal);
      return { status: 200, chunks: (async function* () {})() };
    };

    await streamRunEvents("abc123", {
      onEvent: () => {},
      open,
      signal: stop.signal,
    });

    expect(handed).toEqual([stop.signal]);
  });

  it("스트림을 열지 못하면 왜 그런지 쉬운 말로 말한다", async () => {
    const open = async () => ({ status: 404, chunks: (async function* () {})() });

    const end = await streamRunEvents("gone", { onEvent: () => {}, open });

    expect(end.ended).toBe(false);
    expect(translate("ko", end.failure!)).not.toBe("");
  });

  it("읽는 중에 길이 막히면 던지지 않고 들은 자리까지 말한다", async () => {
    const open = async () => ({
      status: 200,
      chunks: (async function* () {
        yield frame(serverEvent(0, "run.started"));
        throw new TypeError("network error");
      })(),
    });
    const seen = watching();

    const end = await streamRunEvents("abc123", { onEvent: seen.onEvent, open });

    expect(seen.events).toHaveLength(1);
    expect(end.ended).toBe(false);
    expect(end.lastSeq).toBe(0);
  });
});
