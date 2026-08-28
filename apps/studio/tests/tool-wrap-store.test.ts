// 붙여 넣은 것을 연결로 바꾸는 흐름 — 승인 전에는 문서가 그대로다 (DESIGN §7 tool-wrap-card).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec, ResourceBinding } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

const PROPOSED: ResourceBinding = {
  id: "article-search",
  kind: "http.api",
  server_ref: "api://article-search",
  allowed_tools: [],
  approval_policy: "read_only_auto",
  tools: [
    {
      name: "search_articles",
      plain_description: { ko: "글을 찾는다.", en: "Finds articles." },
      input_schema: {
        type: "object",
        properties: { query: { type: "string", title: "What to look for" } },
      },
      output_schema: {
        type: "object",
        properties: { articles: { type: "array", title: "Articles" } },
      },
      timeout_ms: 8000,
      call: {
        transport: "http",
        method: "GET",
        url_template: "https://api.example.com/search",
        auth: "secret://article-api-key",
      },
      result_handling: { mode: "full" },
    },
  ],
} as unknown as ResourceBinding;

function candidateWith(binding: ResourceBinding): AgentSpec {
  return {
    ...example,
    resources: [...(example.resources ?? []), binding],
  } as AgentSpec;
}

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
  useEditor.setState({
    wrapToolsOnServer: async () => ({ candidate: candidateWith(PROPOSED), issues: [] }),
  });
  store().closeToolWrap();
});

describe("붙여 넣은 것을 연결로 바꾸기", () => {
  it("미리보기가 떠도 승인 전에는 문서의 연결이 그대로다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");

    await store().buildToolWrap();

    expect(store().toolWrapCandidate?.resources).toHaveLength(2);
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("승인하면 그 연결이 문서에 들어오고 되돌리기 한 걸음으로 빠진다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().applyToolWrap();

    expect(store().spec?.resources?.map((one) => one.id)).toEqual([
      "clinical-reference",
      "article-search",
    ]);
    store().undo();
    expect(store().spec?.resources?.map((one) => one.id)).toEqual(["clinical-reference"]);
  });

  it("승인하면 카드는 닫히고 적어 둔 것도 남지 않는다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().applyToolWrap();

    expect(store().toolWrapMode).toBe("closed");
    expect(store().toolWrapCandidate).toBeNull();
  });

  it("다시 적기를 고르면 문서는 그대로고 적던 글은 남는다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().rewriteToolWrap();

    expect(store().toolWrapMode).toBe("input");
    expect(store().toolWrapSource).toBe("openapi: 3.1.0");
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("그만두면 문서는 그대로다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().closeToolWrap();

    expect(store().toolWrapMode).toBe("closed");
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("붙여 넣은 것이 없으면 물어보지 않고 무엇이 필요한지 말한다", async () => {
    store().openToolWrap();

    await store().buildToolWrap();

    expect(store().toolWrapCandidate).toBeNull();
    expect(store().toolWrapError).toEqual({ key: "toolWrap.error.empty" });
  });

  it("서버가 답하지 못하면 적어 둔 것을 잃지 않는다", async () => {
    useEditor.setState({
      wrapToolsOnServer: async () => ({ failure: { key: "toolWrap.error.offline" } }),
    });
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");

    await store().buildToolWrap();

    expect(store().toolWrapMode).toBe("input");
    expect(store().toolWrapSource).toBe("openapi: 3.1.0");
    expect(store().toolWrapError).toEqual({ key: "toolWrap.error.offline" });
  });

  it("실행을 보는 동안에는 만들기가 열리지 않는다", () => {
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().openToolWrap();

    expect(store().toolWrapMode).toBe("closed");
  });

  it("승인은 미리보기가 보여 준 것만 옮긴다 — 보이지 않은 삭제는 따라가지 않는다", async () => {
    // 서버는 더하기만 허용하지만, 화면도 스스로 지킨다: 사람이 본 것과 넣는 것이 같다.
    useEditor.setState({
      wrapToolsOnServer: async () => ({
        candidate: { ...example, resources: [PROPOSED] } as AgentSpec,
        issues: [],
      }),
    });
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().applyToolWrap();

    expect(store().spec?.resources?.map((one) => one.id)).toEqual([
      "clinical-reference",
      "article-search",
    ]);
  });

  it("실행이 시작되면 승인은 조용히 버려지지 않고 까닭을 말한다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().applyToolWrap();

    expect(store().spec?.resources).toHaveLength(1);
    expect(store().toolWrapMode).toBe("review");
    expect(store().toolWrapCandidate).not.toBeNull();
    expect(store().toolWrapError).toEqual({ key: "run.locked" });
  });

  it("다른 문서를 열면 만들던 것도 그 문서의 것이었다", async () => {
    store().openToolWrap();
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().loadSpec(example);

    expect(store().toolWrapMode).toBe("closed");
    expect(store().toolWrapCandidate).toBeNull();
    expect(store().toolWrapSource).toBe("");
  });
});
