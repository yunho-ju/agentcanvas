// 실행에 넣을 값이 무엇인지 정하는 순수 규칙 (DESIGN §7 run-input-card "필드 원천").
// 화면은 이 표를 그리기만 한다 — 무엇을 물을지는 그래프에서 나온다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { filledInput, runInputFields } from "../src/run/runInput";

const example = exampleSpec as unknown as AgentSpec;

/** 입력 노드의 bindings와 문서의 input_schema만 갈아 끼운 그래프. */
function graphAsking(
  bindings: Record<string, string>,
  inputSchema: Record<string, unknown> = {},
): AgentSpec {
  return {
    ...example,
    input_schema: inputSchema,
    nodes: example.nodes.map((node) =>
      node.type === "core.input" ? { ...node, config: { bindings } } : node,
    ),
  } as AgentSpec;
}

describe("실행이 사람에게 물을 것", () => {
  it("입력 노드가 받는 값 이름마다 하나씩 묻는다", () => {
    const fields = runInputFields(graphAsking({ question: "input.question" }));

    expect(fields.map((field) => field.name)).toEqual(["question"]);
  });

  it("받는 값이 없으면 물을 것도 없다", () => {
    expect(runInputFields(graphAsking({}))).toEqual([]);
  });

  it("입력 노드가 없는 그래프에는 물을 것이 없다", () => {
    const graph = {
      ...example,
      nodes: example.nodes.filter((node) => node.type !== "core.input"),
    } as AgentSpec;

    expect(runInputFields(graph)).toEqual([]);
  });

  it("이름만 있는 값은 글로 적는 칸이 된다 — 라벨은 그 이름이다", () => {
    const [field] = runInputFields(graphAsking({ question: "input.question" }));

    expect(field.control).toBe("text");
    expect(field.label).toEqual({ ko: "question", en: "question" });
    expect(field.required).toBe(false);
  });

  it("문서가 제목과 타입을 들고 있으면 그대로 살아난다", () => {
    const fields = runInputFields(
      graphAsking(
        { question: "input.question", agreed: "input.agreed" },
        {
          type: "object",
          properties: {
            question: {
              type: "string",
              title: "Question",
              "x-i18n": { ko: { title: "물어볼 것" } },
            },
            agreed: { type: "boolean", title: "Agreed" },
          },
          required: ["question"],
        },
      ),
    );

    expect(fields.map((field) => field.control)).toEqual(["text", "boolean"]);
    expect(fields[0].label).toEqual({ ko: "물어볼 것", en: "Question" });
    expect(fields[0].required).toBe(true);
    expect(fields[1].required).toBe(false);
  });

  it("스키마에 있어도 아무도 받지 않는 값은 묻지 않는다", () => {
    const fields = runInputFields(
      graphAsking(
        { question: "input.question" },
        {
          type: "object",
          properties: { question: { type: "string" }, unused: { type: "string" } },
        },
      ),
    );

    expect(fields.map((field) => field.name)).toEqual(["question"]);
  });

  it("입력 노드가 여럿이면 받는 값을 한 번씩만 모은다", () => {
    const asking = graphAsking({ question: "input.question" });
    const twice = {
      ...asking,
      nodes: [
        ...asking.nodes,
        {
          id: "input-2",
          type: "core.input",
          position: { x: 0, y: 200 },
          config: { bindings: { question: "input.question", topic: "input.topic" } },
        },
      ],
    } as AgentSpec;

    expect(runInputFields(twice).map((field) => field.name)).toEqual([
      "question",
      "topic",
    ]);
  });
});

describe("서버로 보낼 값", () => {
  it("적은 값만 보낸다", () => {
    expect(filledInput({ question: "왜", topic: "" })).toEqual({ question: "왜" });
  });

  it("아무것도 적지 않았으면 보낼 값이 없다", () => {
    expect(filledInput({ question: "", topic: "   " })).toEqual({});
    expect(filledInput({})).toEqual({});
  });

  it("글이 아닌 값은 적힌 그대로 보낸다 — 거짓도 값이다", () => {
    expect(filledInput({ agreed: false, score: 0 })).toEqual({ agreed: false, score: 0 });
  });

  it("비어 있는 자리는 값이 아니다", () => {
    expect(filledInput({ note: undefined, other: null })).toEqual({});
  });
});
