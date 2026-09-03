// 주소 하나를 서버에 묻는 문 — 서버가 대는 까닭은 화면에서 쉬운 말 한 줄이 된다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import { draftSkillOnServer } from "../src/api/skillDraft";
import { fetchSkillOnServer } from "../src/api/skills";
import { translate } from "../src/i18n/messages";

function response(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

describe("skill 원문을 가져오는 문", () => {
  it("적은 주소를 그대로 실어 묻고, 원문과 온 자리를 읽는다", async () => {
    const calls: { url: string; signal?: AbortSignal }[] = [];
    const fetch = async (
      url: string,
      init: { method: string; signal?: AbortSignal },
    ) => {
      calls.push({ url, signal: init.signal });
      return response(200, { text: "---\n" });
    };

    const outcome = await fetchSkillOnServer("https://skills.sh/a/b/c", {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].url).toBe(
      "http://here/skills/fetch?url=https%3A%2F%2Fskills.sh%2Fa%2Fb%2Fc",
    );
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(outcome).toEqual({ text: "---\n" });
  });

  it.each([
    ["skill.fetch.host", 400, /이 주소에서는 가져올 수 없어요/],
    ["skill.fetch.notfound", 404, /skill을 찾지 못했어요/],
    ["skill.fetch.toolarge", 413, /너무 커서/],
    ["skill.fetch.timeout", 504, /제때 답하지 않았어요/],
  ])("서버가 댄 까닭 %s를 쉬운 말 한 줄로 옮긴다", async (detail, status, said) => {
    const fetch = async () => response(status, { detail });

    const outcome = await fetchSkillOnServer("https://skills.sh/a/b/c", { fetch });

    expect(outcome.text).toBeUndefined();
    const line = translate("ko", outcome.failure!);
    expect(line).toMatch(said);
    // 원문 코드는 화면에 나가지 않는다.
    expect(line).not.toContain(detail);
  });

  it("모르는 까닭도 침묵하지 않고 일반 문구로 말한다", async () => {
    const fetch = async () => response(500, { detail: "something else" });

    const outcome = await fetchSkillOnServer("https://skills.sh/a/b/c", { fetch });

    expect(translate("ko", outcome.failure!)).toMatch(/알 수 없는 답이 왔어요/);
  });

  it("서버에 닿지 못하면 그 사실을 다른 말로 말한다", async () => {
    const fetch = async () => {
      throw new Error("offline");
    };

    const outcome = await fetchSkillOnServer("https://skills.sh/a/b/c", { fetch });

    expect(translate("ko", outcome.failure!)).toMatch(/서버에 닿지 못했어요/);
  });
});

describe("skill 초안을 청하는 문", () => {
  const ask = {
    instruction: "Answer plainly.",
    name: "plain-answer",
    description: "Use when you answer a person",
    references: [],
  };

  it("적은 것과 참고를 실어 묻고, 무엇이 지었는지까지 읽는다", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetch = async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, body: init.body });
      return response(200, { text: "---\n", drafted_by: "scaffold", issues: [] });
    };

    const outcome = await draftSkillOnServer(ask, { baseUrl: "http://here", fetch });

    expect(calls[0].url).toBe("http://here/skills/draft");
    expect(JSON.parse(calls[0].body!)).toMatchObject({
      instruction: "Answer plainly.",
      name: "plain-answer",
      description: "Use when you answer a person",
    });
    expect(outcome).toEqual({ text: "---\n", draftedBy: "scaffold" });
  });

  // 서버가 적은 것을 물린 것과 서버가 잠시 흔들린 것은 다른 일이고, 사람이 할 일도 다르다.
  it("적은 것을 서버가 물리면 다시 해보라는 말 대신 무엇을 고칠지 말한다", async () => {
    const fetch = async () => response(422, { detail: [{ loc: ["body", "name"] }] });

    const outcome = await draftSkillOnServer(ask, { fetch });

    const line = translate("ko", outcome.failure!);
    expect(line).toMatch(/이름이나 '언제 쓰나요'/);
    expect(line).not.toMatch(/잠시 뒤 다시/);
  });

  it("그 밖의 흔들림은 잠시 뒤 다시 해보라고 말한다", async () => {
    const fetch = async () => response(503, { detail: "provider is down" });

    const outcome = await draftSkillOnServer(ask, { fetch });

    const line = translate("ko", outcome.failure!);
    expect(line).toMatch(/잠시 뒤 다시/);
    expect(line).not.toContain("provider is down");
  });
});
