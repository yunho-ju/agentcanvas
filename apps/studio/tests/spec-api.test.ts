// 서버로 나가는 유일한 문 — 여기서만 fetch를 부른다. 시험은 가짜 fetch를 꽂아 넣는다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import {
  fetchSavedDocs,
  fetchSavedSpec,
  fetchSpecRevisions,
  sendSpecToServer,
} from "../src/api/specs";
import { DEFAULT_BASE_URL, type HttpResponse } from "../src/api/http";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 서버 대신 대답하는 사람 — 무엇을 물었는지 받아 적는다. */
function server(...replies: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body ?? "null"),
    });
    const reply = replies[calls.length - 1] ?? replies.at(-1);
    return {
      status: reply?.status ?? 500,
      json: async () => reply?.body ?? {},
    } satisfies HttpResponse;
  };
  return { calls, fetch };
}

function envelope(spec: AgentSpec, issues: unknown[] = []) {
  return { spec, issues };
}

const saved = { ...example, revision: `sha256:${"a".repeat(64)}`, version: 7 };

describe("그래프를 서버에 맡기는 일", () => {
  it("처음 보내는 그래프는 새로 만든다", async () => {
    const { calls, fetch } = server({ status: 201, body: envelope(saved) });

    const outcome = await sendSpecToServer(example, { baseUrl: "http://here", fetch });

    expect(calls).toEqual([
      {
        url: "http://here/specs",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: example,
      },
    ]);
    expect(outcome.saved).toEqual(saved);
    expect(outcome.issues).toEqual([]);
  });

  it("이미 있는 그래프라고 하면 고치는 길로 이어 간다", async () => {
    const { calls, fetch } = server(
      { status: 409, body: { detail: "already saved" } },
      { status: 200, body: envelope(saved) },
    );

    const outcome = await sendSpecToServer(example, { baseUrl: "http://here", fetch });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST http://here/specs",
      `PUT http://here/specs/${example.id}`,
    ]);
    expect(calls[0]?.headers).toEqual({ "content-type": "application/json" });
    expect(calls[1]?.headers).toEqual({
      "content-type": "application/json",
      "If-Match": example.revision,
    });
    expect(outcome.saved).toEqual(saved);
  });

  it("다른 변경이 먼저 저장되면 충돌로 말하고 다시 덮어쓰지 않는다", async () => {
    const { calls, fetch } = server(
      { status: 409, body: { detail: "already saved" } },
      { status: 409, body: { detail: "stale revision" } },
    );

    const outcome = await sendSpecToServer(example, { fetch });

    expect(outcome.saved).toBeUndefined();
    expect(outcome.failure?.key).toBe("save.conflict");
    expect(calls).toHaveLength(2);
  });

  it("서버가 본 손볼 곳을 그대로 들고 온다", async () => {
    const issue = { severity: "error", code: "node.unknown_type", message: "무슨 노드죠" };
    const { fetch } = server({ status: 201, body: envelope(saved, [issue]) });

    const outcome = await sendSpecToServer(example, { fetch });

    expect(outcome.issues).toEqual([issue]);
  });

  it("서버에 닿지 못하면 그 사실을 쉬운 말로 돌려준다 — 던지지 않는다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const outcome = await sendSpecToServer(example, { fetch });

    expect(outcome.saved).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
    expect(translate("en", outcome.failure!)).not.toBe("");
  });

  it("계약에 맞지 않는다고 하면 그 까닭을 들고 온다", async () => {
    const { fetch } = server({ status: 422, body: { detail: "state_schema missing" } });

    const outcome = await sendSpecToServer(example, { fetch });

    expect(outcome.saved).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("state_schema missing");
  });

  it("서버가 늘어놓은 오류 목록을 그대로 보여주지 않는다", async () => {
    const { fetch } = server({
      status: 422,
      body: {
        detail: [
          { type: "missing", loc: ["body", "state_schema"], msg: "Field required" },
        ],
      },
    });

    const outcome = await sendSpecToServer(example, { fetch });

    const said = translate("ko", outcome.failure!);
    expect(said).not.toContain("{");
    expect(said).not.toContain("loc");
    expect(said).toContain("계약");
  });

  it("생각지 못한 대답에도 무너지지 않는다", async () => {
    const { fetch } = server({ status: 500, body: {} });

    const outcome = await sendSpecToServer(example, { fetch });

    expect(outcome.saved).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("500");
  });

  it("닿긴 했는데 알 수 없는 답이 오면 닿지 못했다고 말하지 않는다", async () => {
    const fetch = async () =>
      ({
        status: 500,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }) satisfies HttpResponse;

    const outcome = await sendSpecToServer(example, { fetch });

    const said = translate("ko", outcome.failure!);
    expect(said).not.toContain("닿지 못했");
    expect(said).toContain("알 수 없는");
  });

  it("어디로 보낼지는 밖에서 정한다 — 기본값은 내 컴퓨터의 서버다", () => {
    expect(DEFAULT_BASE_URL).toBe("http://localhost:8000");
  });
});

/** 몸통 없이 묻기만 하는 길(GET)에 대답하는 서버. */
function answering(reply: { status: number; body?: unknown }) {
  const asked: string[] = [];
  const fetch = async (url: string, init: { method: string }) => {
    asked.push(`${init.method} ${url}`);
    return {
      status: reply.status,
      json: async () => reply.body ?? {},
    } satisfies HttpResponse;
  };
  return { asked, fetch };
}

const listed = [
  {
    id: "clinical-assistant",
    name: "임상 도우미",
    version: 2,
    revision: `sha256:${"a".repeat(64)}`,
    saved_at: "2026-08-01T12:31:00Z",
  },
];

describe("서버에 저장해 둔 문서 목록", () => {
  it("서버가 준 목록을 그대로 들고 온다", async () => {
    const { asked, fetch } = answering({
      status: 200,
      body: { documents: listed, has_more: false },
    });

    const outcome = await fetchSavedDocs({ baseUrl: "http://here", fetch });

    expect(asked).toEqual(["GET http://here/specs"]);
    expect(outcome.documents).toEqual(listed);
    expect(outcome.hasMore).toBe(false);
  });

  it("뒤에 더 있다는 서버의 말을 그대로 들고 온다 — 개수로 짐작하지 않는다", async () => {
    const { fetch } = answering({
      status: 200,
      body: { documents: listed, has_more: true },
    });

    const outcome = await fetchSavedDocs({ fetch });

    expect(outcome.hasMore).toBe(true);
  });

  it("아직 아무도 저장하지 않았으면 빈 목록이다 — 실패가 아니다", async () => {
    const { fetch } = answering({
      status: 200,
      body: { documents: [], has_more: false },
    });

    const outcome = await fetchSavedDocs({ fetch });

    expect(outcome.documents).toEqual([]);
    expect(outcome.failure).toBeUndefined();
  });

  it("서버에 닿지 못하면 쉬운 말로 돌려준다 — 던지지 않는다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const outcome = await fetchSavedDocs({ fetch });

    expect(outcome.documents).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("서버");
    expect(translate("en", outcome.failure!)).not.toBe("");
  });

  it("목록이 아닌 답은 목록으로 삼지 않는다", async () => {
    const { fetch } = answering({ status: 200, body: { specs: "?" } });

    const outcome = await fetchSavedDocs({ fetch });

    expect(outcome.documents).toBeUndefined();
    expect(translate("ko", outcome.failure!)).not.toBe("");
  });

  it("목록 GET 오류의 서버 detail은 화면 문장으로 옮기지 않는다", async () => {
    const raw = "secret provider trace";
    const { fetch } = answering({ status: 502, body: { detail: raw } });

    const outcome = await fetchSavedDocs({ fetch });

    const said = translate("ko", outcome.failure!);
    expect(said).not.toContain(raw);
    expect(said).toContain("502");
  });
});

describe("저장해 둔 문서 하나를 가져오는 일", () => {
  it("서버가 준 봉투에서 그래프와 손볼 곳을 꺼낸다", async () => {
    const { asked, fetch } = answering({ status: 200, body: envelope(saved) });

    const outcome = await fetchSavedSpec("clinical-assistant", {
      baseUrl: "http://here",
      fetch,
    });

    expect(asked).toEqual(["GET http://here/specs/clinical-assistant"]);
    expect(outcome.saved).toEqual(saved);
  });

  it("서버가 모르는 문서라고 하면 그렇게 말한다", async () => {
    const { fetch } = answering({ status: 404, body: { detail: "no graph" } });

    const outcome = await fetchSavedSpec("nowhere", { fetch });

    expect(outcome.saved).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("찾지 못했어요");
  });
});

const revisions = [
  {
    version: 4,
    revision: `sha256:${"b".repeat(64)}`,
    created_at: "2026-08-02T12:31:00Z",
  },
  {
    version: 3,
    revision: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-01T12:31:00Z",
  },
];

describe("저장해 둔 문서의 판 기록", () => {
  it("서버가 준 순서와 머리말을 그대로 들고 온다", async () => {
    const { asked, fetch } = answering({ status: 200, body: { revisions } });

    const outcome = await fetchSpecRevisions("clinical assistant", {
      baseUrl: "http://here",
      fetch,
    });

    expect(asked).toEqual(["GET http://here/specs/clinical%20assistant/revisions"]);
    expect(outcome.revisions).toEqual(revisions);
  });

  it("빈 판 기록은 실패가 아니다", async () => {
    const { fetch } = answering({ status: 200, body: { revisions: [] } });

    const outcome = await fetchSpecRevisions("clinical-assistant", { fetch });

    expect(outcome.revisions).toEqual([]);
    expect(outcome.failure).toBeUndefined();
  });

  it("문서를 찾지 못하면 서버 원문 없이 그렇게 말한다", async () => {
    const { fetch } = answering({ status: 404, body: { detail: "secret revision detail" } });

    const outcome = await fetchSpecRevisions("nowhere", { fetch });
    const said = translate("ko", outcome.failure!);

    expect(said).toContain("찾지 못했어요");
    expect(said).not.toContain("secret revision detail");
  });

  it("서버에 닿지 못하면 offline 문장으로 돌려준다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const outcome = await fetchSpecRevisions("clinical-assistant", { fetch });

    expect(outcome.revisions).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("닿지 못했어요");
  });

  it("판 목록 모양을 읽을 수 없으면 malformed 문장으로 돌려준다", async () => {
    const { fetch } = answering({ status: 200, body: { revisions: [{ version: 4 }] } });

    const outcome = await fetchSpecRevisions("clinical-assistant", { fetch });

    expect(outcome.revisions).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("알 수 없는");
  });

  it("JSON을 읽을 수 없으면 offline으로 가장하지 않는다", async () => {
    const fetch = async () =>
      ({
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }) satisfies HttpResponse;

    const outcome = await fetchSpecRevisions("clinical-assistant", { fetch });
    const said = translate("ko", outcome.failure!);

    expect(said).toContain("알 수 없는");
    expect(said).not.toContain("닿지 못했어요");
  });

  it("다른 서버 오류도 detail을 화면 문장으로 옮기지 않는다", async () => {
    const { fetch } = answering({ status: 500, body: { detail: "secret provider trace" } });

    const outcome = await fetchSpecRevisions("clinical-assistant", { fetch });
    const said = translate("ko", outcome.failure!);

    expect(said).toContain("500");
    expect(said).not.toContain("secret provider trace");
  });
});
