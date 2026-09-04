// src/api/patterns.ts를 fetch 레벨로 고정한다 — models-api.test.ts와 같은 관례.
// 규칙 하나: 못 들었으면 "모른다"(null)라고 하고, 화면은 칩 없이 지나간다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import { fetchServerPatternsFromServer } from "../src/api/patterns";

function server(reply: { status: number; body?: unknown }) {
  const calls: { url: string; method: string }[] = [];
  const fetch = async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    return { status: reply.status, json: async () => reply.body } satisfies HttpResponse;
  };
  return { calls, fetch };
}

const REACT = {
  id: "react",
  short_name: { ko: "도구를 쓰며 답 다듬기", en: "Look things up while answering" },
  question: { ko: "물음", en: "question" },
  applies_when: { ko: "언제", en: "when" },
  cost: { ko: "대가", en: "cost" },
  needs: ["tool_calling"],
  template: [],
  detects: "agent_calls_tools_once",
};

describe("fetchServerPatternsFromServer — 이 서버가 놓아 줄 수 있는 모양", () => {
  it("서버의 모양 목록에 묻고, 짧은 이름까지 읽는다", async () => {
    const { calls, fetch } = server({ status: 200, body: { patterns: [REACT] } });

    const patterns = await fetchServerPatternsFromServer({
      baseUrl: "http://here",
      fetch,
    });

    expect(calls).toEqual([{ url: "http://here/patterns", method: "GET" }]);
    expect(patterns).toEqual([{ id: "react", shortName: REACT.short_name }]);
  });

  it("서버에 닿지 못하면 모른다고 한다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    expect(await fetchServerPatternsFromServer({ fetch })).toBeNull();
  });

  it("서버가 거절하면 모른다고 한다", async () => {
    const { fetch } = server({ status: 401, body: { detail: "nope" } });

    expect(await fetchServerPatternsFromServer({ fetch })).toBeNull();
  });

  it("답의 모양이 어긋나면 모른다고 한다", async () => {
    const { fetch } = server({ status: 200, body: { patterns: [{ id: "react" }] } });

    expect(await fetchServerPatternsFromServer({ fetch })).toBeNull();
  });
});
