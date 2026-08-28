// 붙여 넣은 것을 서버에 묻는 문 — 화면은 patch 작업을 조립하지 않고 candidate만 안다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { HttpResponse } from "../src/api/http";
import { wrapToolsOnServer } from "../src/api/toolWrap";
import type { AgentSpec } from "../src/generated/agent_spec";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

function response(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

describe("연결 제안을 물어보는 문", () => {
  it("붙여 넣은 것과 지금 문서를 그대로 보내고 candidate를 읽는다", async () => {
    const calls: { url: string; body?: string; signal?: AbortSignal }[] = [];
    const fetch = async (
      url: string,
      init: { method: string; body?: string; signal?: AbortSignal },
    ) => {
      calls.push({ url, body: init.body, signal: init.signal });
      return response(200, { candidate: example, patch: {}, issues: [] });
    };

    const outcome = await wrapToolsOnServer("curl https://x", "curl", example, undefined, {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe("http://here/tools/wrap");
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({
      model_ref: "model://openai",
      source_kind: "curl",
      source: "curl https://x",
      base_spec: example,
    });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(outcome).toEqual({ candidate: example, issues: [] });
  });

  it("닿지 못한 것과 알 수 없는 답을 가려서 말한다", async () => {
    const offline = await wrapToolsOnServer("paste", "openapi", example, undefined, {
      fetch: async () => {
        throw new TypeError("offline");
      },
    });
    const strange = await wrapToolsOnServer("paste", "openapi", example, undefined, {
      fetch: async () => response(200, { patch: {} }),
    });

    expect(translate("ko", offline.failure!)).toContain("닿지 못");
    expect(translate("ko", strange.failure!)).toContain("알 수 없는");
  });

  it("서버가 물린 까닭을 화면의 말로 옮기고 원문을 옮기지 않는다", async () => {
    const refused = await wrapToolsOnServer("paste", "prose", example, undefined, {
      fetch: async () =>
        response(502, { detail: "provider raw answer sk-never-show-this" }),
    });

    const said = translate("ko", refused.failure!);
    expect(said).toContain("502");
    expect(said).not.toContain("sk-never-show-this");
  });
});
