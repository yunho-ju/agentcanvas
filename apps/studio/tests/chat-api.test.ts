// 대화를 서버에 부탁하는 문 — 말을 걸고, 오간 말을 되읽고, 대화를 지운다.
// 판은 서버가 집는다: 여기서 revision을 계산하지 않는다 (게시된 판은 대화 도중 움직이지 않는다).
// 화면에서 부르는 자리는 CHAT-3b가 연다 — 여기서는 문의 계약만 고정한다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import { startChatTurnOnServer } from "../src/api/runs";
import { deleteThreadOnServer, fetchThreadRuns } from "../src/api/threads";
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
