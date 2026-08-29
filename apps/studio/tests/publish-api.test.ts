// 게시 문 — 여기서만 fetch를 부른다. 시험은 가짜 fetch를 꽂아 어느 주소로 무엇을 보내는지 본다.
import { describe, expect, it } from "vitest";
import { fetchPublication, publishSpec, unpublishSpec } from "../src/api/publish";
import { DEFAULT_BASE_URL, type HttpResponse } from "../src/api/http";
import type { SpecPublication } from "../src/generated/spec_publication";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function server(...replies: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body ?? "null") });
    const reply = replies[calls.length - 1] ?? replies.at(-1);
    return {
      status: reply?.status ?? 500,
      json: async () => reply?.body ?? null,
    } satisfies HttpResponse;
  };
  return { calls, fetch };
}

const REVISION = `sha256:${"1".repeat(64)}`;
const PUBLICATION: SpecPublication = {
  spec_id: "clinical-assistant",
  revision: REVISION,
  published_at: "2026-08-29T09:00:00+00:00",
};

describe("게시 API 문", () => {
  it("저장된 판을 그 문서의 publish 주소로 보낸다", async () => {
    const { calls, fetch } = server({ status: 200, body: PUBLICATION });

    const outcome = await publishSpec("clinical-assistant", REVISION, { fetch });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/specs/clinical-assistant/publish`);
    expect(calls[0].body).toEqual({ revision: REVISION });
    expect(outcome.publication?.revision).toBe(REVISION);
  });

  it("저장된 적 없는 판(404)은 쉬운 말로 물린다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "never saved" } });

    const outcome = await publishSpec("clinical-assistant", REVISION, { fetch });

    expect(outcome.publication).toBeUndefined();
    expect(outcome.failure).toBeDefined();
  });

  it("게시를 내리는 문은 DELETE로 부른다", async () => {
    const { calls, fetch } = server({ status: 204 });

    const outcome = await unpublishSpec("clinical-assistant", { fetch });

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/specs/clinical-assistant/publish`);
    expect(outcome.ok).toBe(true);
  });

  it("게시된 판이 없으면 null로 답한다 (실패가 아니다)", async () => {
    const { calls, fetch } = server({ status: 200, body: null });

    const outcome = await fetchPublication("clinical-assistant", { fetch });

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`${DEFAULT_BASE_URL}/specs/clinical-assistant/publication`);
    expect(outcome.publication).toBeNull();
    expect(outcome.failure).toBeUndefined();
  });

  it("게시된 판을 그대로 읽어 돌려준다", async () => {
    const { fetch } = server({ status: 200, body: PUBLICATION });

    const outcome = await fetchPublication("clinical-assistant", { fetch });

    expect(outcome.publication?.revision).toBe(REVISION);
  });
});
