// 대화를 서버에 부탁하는 문 — 말을 걸고, 오간 말을 되읽고, 대화를 지운다.
// 판은 서버가 집는다: 여기서 revision을 계산하지 않는다 (게시된 판은 대화 도중 움직이지 않는다).
// 화면에서 부르는 자리는 CHAT-3b가 연다 — 여기서는 문의 계약만 고정한다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import { cancelRunOnServer, startChatTurnOnServer } from "../src/api/runs";
import {
  deleteThreadOnServer,
  fetchSpecThreads,
  fetchThreadEvents,
  fetchThreadRuns,
} from "../src/api/threads";
import { translate } from "../src/i18n/messages";

const REVISION = `sha256:${"a".repeat(64)}`;
const SPEC_ID = "clinical-assistant";

const run = {
  id: "abc123",
  spec_id: SPEC_ID,
  spec_revision: REVISION,
  created_at: "2026-08-01T12:30:00Z",
  thread_id: "thread_1",
  end_user_ref: null,
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

describe("게시된 판에 말을 거는 일", () => {
  it("어느 대화의 누구 말인지 적어 보내고, 판은 서버가 집게 둔다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "running" } });

    const outcome = await startChatTurnOnServer(
      SPEC_ID,
      {
        threadId: "thread_1",
        endUserRef: "end-user://amy",
        input: { question: "무엇을 볼까" },
      },
      { baseUrl: "http://here", fetch },
    );

    expect(calls).toEqual([
      {
        url: "http://here/specs/clinical-assistant/runs",
        method: "POST",
        body: {
          revision_source: "published",
          thread_id: "thread_1",
          end_user_ref: "end-user://amy",
          input: { question: "무엇을 볼까" },
        },
      },
    ]);
    expect(outcome.run).toEqual(run);
  });

  it("적지 않은 것은 적은 척 보내지 않는다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "running" } });

    await startChatTurnOnServer(
      SPEC_ID,
      { threadId: "thread_1" },
      { baseUrl: "http://here", fetch },
    );

    expect(calls[0].body).toEqual({
      revision_source: "published",
      thread_id: "thread_1",
    });
  });

  it("내놓은 판이 없으면 무엇을 해야 하는지 말해 준다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "not published" } });

    const outcome = await startChatTurnOnServer(
      SPEC_ID,
      { threadId: "thread_1" },
      { baseUrl: "http://here", fetch },
    );

    expect(outcome.run).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("게시");
  });
});

describe("한 대화에 오간 말을 되읽는 일", () => {
  it("말한 순서대로 온다", async () => {
    const { calls, fetch } = server({ status: 200, body: [run] });

    const outcome = await fetchThreadRuns("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/threads/thread_1/runs");
    expect(calls[0].method).toBe("GET");
    expect(outcome.runs).toEqual([run]);
  });

  it("서버가 답하지 못하면 던지지 않고 까닭을 돌려준다", async () => {
    const { fetch } = server({ status: 500, body: {} });

    const outcome = await fetchThreadRuns("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(outcome.runs).toBeUndefined();
    expect(translate("ko", outcome.failure!).length).toBeGreaterThan(0);
  });
});

describe("한 그래프의 지난 대화들을 되읽는 일", () => {
  const thread = {
    thread_id: "thread_1",
    first_said: "무엇을 볼까",
    started_at: "2026-08-01T12:30:00Z",
    last_at: "2026-08-01T12:40:00Z",
    turns: 2,
    last_status: "completed",
    spec_revision: REVISION,
  };

  it("요약을 곁들여 한 번에 온다 — 대화마다 되묻지 않는다", async () => {
    const { calls, fetch } = server({ status: 200, body: [thread] });

    const outcome = await fetchSpecThreads(SPEC_ID, {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/specs/clinical-assistant/threads");
    expect(calls[0].method).toBe("GET");
    expect(outcome.threads).toEqual([thread]);
  });

  it("서버가 답하지 못하면 던지지 않고 까닭을 돌려준다", async () => {
    const { fetch } = server({ status: 500, body: {} });

    const outcome = await fetchSpecThreads(SPEC_ID, {
      baseUrl: "http://here",
      fetch,
    });

    expect(outcome.threads).toBeUndefined();
    expect(translate("ko", outcome.failure!).length).toBeGreaterThan(0);
  });
});

describe("한 대화에 쌓인 이벤트를 되읽는 일", () => {
  const turn = {
    run,
    events: [
      {
        seq: 0,
        run_id: run.id,
        event_type: "run.started",
        timestamp: "2026-08-01T12:30:00Z",
        spec_revision: REVISION,
        payload: { spec_id: SPEC_ID },
      },
    ],
  };

  it("실행별로 묶여, 말한 순서대로 온다", async () => {
    const { calls, fetch } = server({ status: 200, body: [turn] });

    const outcome = await fetchThreadEvents("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/threads/thread_1/events");
    expect(calls[0].method).toBe("GET");
    expect(outcome.turns).toEqual([turn]);
  });

  it("서버가 답하지 못하면 던지지 않고 까닭을 돌려준다", async () => {
    const { fetch } = server({ status: 500, body: {} });

    const outcome = await fetchThreadEvents("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(outcome.turns).toBeUndefined();
    expect(translate("ko", outcome.failure!).length).toBeGreaterThan(0);
  });
});

describe("대화를 지우는 일", () => {
  it("다 끝난 대화는 통째로 지워진다", async () => {
    const { calls, fetch } = server({ status: 204 });

    const outcome = await deleteThreadOnServer("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/threads/thread_1");
    expect(calls[0].method).toBe("DELETE");
    expect(outcome.ok).toBe(true);
  });

  it("아직 흐르는 대화는 왜 지우지 못했는지 말해 준다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "still going" } });

    const outcome = await deleteThreadOnServer("thread_1", {
      baseUrl: "http://here",
      fetch,
    });

    expect(outcome.ok).toBeUndefined();
    expect(translate("ko", outcome.failure!).length).toBeGreaterThan(0);
  });
});

describe("첫 말은 대화 이름 없이 나간다 (CHAT-3b 결정 5)", () => {
  it("아직 대화가 없으면 대화 이름을 지어내지 않는다 — 서버가 실행 이름으로 연다", async () => {
    const { calls, fetch } = server({ status: 201, body: { run, status: "running" } });

    await startChatTurnOnServer(
      SPEC_ID,
      { input: { message: "안녕" } },
      { baseUrl: "http://here", fetch },
    );

    expect(calls[0].body).toEqual({
      revision_source: "published",
      input: { message: "안녕" },
    });
  });
});

describe("기다리던 말을 그만두는 일", () => {
  it("그 실행을 그만두라고 서버에 부탁한다", async () => {
    const { calls, fetch } = server({ status: 200, body: { run, status: "cancelled" } });

    const outcome = await cancelRunOnServer("abc123", {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/runs/abc123/cancel");
    expect(calls[0].method).toBe("POST");
    expect(outcome.ok).toBe(true);
  });

  it("그만두지 못했으면 까닭을 쉬운 말로 돌려준다 — 서버 원문은 싣지 않는다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no run called abc123" } });

    const outcome = await cancelRunOnServer("abc123", {
      baseUrl: "http://here",
      fetch,
    });

    expect(outcome.ok).toBeUndefined();
    expect(translate("ko", outcome.failure!)).not.toContain("no run called");
  });
});
