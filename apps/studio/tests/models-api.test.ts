// src/api/models.ts를 fetch 레벨로 고정한다 — eval-api.test.ts와 같은 관례.
// 이 문의 규칙 하나: 못 들었으면 "모른다"(null)라고 하고, 화면이 예전 목록으로 돌아가게 둔다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import { fetchServerModelsFromServer } from "../src/api/models";

function server(reply: { status: number; body?: unknown }) {
  const calls: { url: string; method: string }[] = [];
  const fetch = async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    return { status: reply.status, json: async () => reply.body } satisfies HttpResponse;
  };
  return { calls, fetch };
}

const OPENAI = {
  ref: "model://openai",
  title: { ko: "OpenAI의 모델 — gpt-x", en: "OpenAI — gpt-x" },
  callable: true,
  reason: null,
};

describe("fetchServerModelsFromServer — 이 서버가 부를 수 있는 모델", () => {
  it("서버의 카탈로그 길에 묻고, 도는 자리와 부를 수 있는지까지 읽는다", async () => {
    const { calls, fetch } = server({
      status: 200,
      body: { mode: "live", models: [OPENAI] },
    });

    const catalog = await fetchServerModelsFromServer({ baseUrl: "http://here", fetch });

    expect(calls).toEqual([{ url: "http://here/models", method: "GET" }]);
    expect(catalog).toEqual({ mode: "live", models: [OPENAI] });
  });

  it("서버에 닿지 못하면 모른다고 한다 — 부를 수 없다고 말하지 않는다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    expect(await fetchServerModelsFromServer({ fetch })).toBeNull();
  });

  it("서버가 거절하면 모른다고 한다", async () => {
    const { fetch } = server({ status: 401, body: { detail: "authentication required" } });

    expect(await fetchServerModelsFromServer({ fetch })).toBeNull();
  });

  it("답의 모양이 어긋나면 모른다고 한다", async () => {
    const { fetch } = server({ status: 200, body: { mode: "live", models: [{ ref: "model://openai" }] } });

    expect(await fetchServerModelsFromServer({ fetch })).toBeNull();
  });
});
