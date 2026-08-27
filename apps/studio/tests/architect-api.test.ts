import { describe, expect, it } from "vitest";
import { makeArchitectSpec } from "../src/architect/architect";
import { createArchitectDraftOnServer } from "../src/api/architect";
import type { HttpResponse } from "../src/api/http";
import { translate } from "../src/i18n/messages";

function response(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

const candidate = makeArchitectSpec("make an answer", "draft-api");
const patch = {
  schema_version: "agent.patch/v1",
  base_revision: candidate.revision,
  operations: [
    {
      op: "add_node" as const,
      node: { id: "new-node", type: "llm.agent", position: { x: 1, y: 1 } },
    },
  ],
};

describe("provider-backed Architect API", () => {
  it("defaults Guided drafts to the configured external provider ref", async () => {
    const calls: { body?: string }[] = [];
    const fetch = async (_url: string, init: { body?: string }) => {
      calls.push(init);
      return response(200, { candidate, patch, issues: [] });
    };

    await createArchitectDraftOnServer("make an answer", "draft-api", undefined, { fetch });

    expect(JSON.parse(calls[0].body ?? "null")).toMatchObject({ model_ref: "model://openai" });
  });

  it("sends the draft request and reads the preview envelope", async () => {
    const calls: { url: string; init: { method: string; body?: string; signal?: AbortSignal } }[] = [];
    const fetch = async (url: string, init: { method: string; body?: string; signal?: AbortSignal }) => {
      calls.push({ url, init });
      return response(200, { candidate, patch, issues: [] });
    };

    const outcome = await createArchitectDraftOnServer("make an answer", "draft-api", "model://default", { baseUrl: "http://here", fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://here/architect/draft");
    expect(JSON.parse(calls[0].init.body ?? "null")).toEqual({ model_ref: "model://default", request: "make an answer", draft_id: "draft-api" });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(outcome).toEqual({ draft: candidate, patch, issues: [] });
  });

  it("keeps transport failures distinct from malformed server answers", async () => {
    const offline = await createArchitectDraftOnServer("request", "draft", "model://default", { fetch: async () => { throw new TypeError("offline"); } });
    const strange = await createArchitectDraftOnServer("request", "draft", "model://default", { fetch: async () => response(200, { candidate }) });

    expect(translate("ko", offline.failure!)).toContain("닿지 못");
    expect(translate("ko", strange.failure!)).toContain("알 수 없는");
  });

  it("does not expose provider detail on a refused response", async () => {
    const raw = "provider raw answer sk-never-return-this";
    const outcome = await createArchitectDraftOnServer("request", "draft", "model://default", {
      fetch: async () => response(503, { detail: raw }),
    });

    expect(translate("ko", outcome.failure!)).not.toContain(raw);
    expect(translate("ko", outcome.failure!)).toContain("초안");
  });
});
