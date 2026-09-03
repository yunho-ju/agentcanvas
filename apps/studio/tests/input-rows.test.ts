// 입력 노드가 받는 줄 ↔ 문서(bindings + input_schema)를 서로 옮기는 순수 함수
// (DESIGN §7 input-rows · 브리프 UXQ2-4b 케이스 표).
import { describe, expect, it } from "vitest";
import type { Node1 as SpecNode } from "../src/generated/agent_spec";
import {
  type InputRow,
  ROW_KINDS,
  applyRows,
  canBeRequired,
  rowsOf,
  rowsProblem,
  withKind,
} from "../src/graph/inputRows";
import type { JsonSchema } from "../src/registry/registry";

function inputNode(bindings: Record<string, string>): SpecNode {
  return {
    id: "input",
    type: "core.input",
    position: { x: 0, y: 0 },
    config: { bindings },
  } as SpecNode;
}

const ASKING_Q = inputNode({ q: "input.q" });

const SCHEMA_Q: JsonSchema = {
  type: "object",
  properties: { q: { type: "string" } },
  required: ["q"],
};

function row(over: Partial<InputRow> = {}): InputRow {
  return { name: "q", kind: "text", required: false, was: "q", ...over };
}

/** 새 줄 — 아직 문서에 제 이름표가 없다. */
function freshRow(over: Partial<InputRow> = {}): InputRow {
  return { name: "new", kind: "text", required: false, was: null, ...over };
}

describe("문서를 줄로 읽기", () => {
  it("받기로 한 이름마다 한 줄이고, 종류와 필수는 문서가 말한다", () => {
    expect(rowsOf(inputNode({ q: "input.q", n: "input.n" }), SCHEMA_Q)).toEqual([
      { name: "q", kind: "text", required: true, was: "q" },
      { name: "n", kind: "any", required: false, was: "n" },
    ]);
  });

  it("문서에 항목이 없는 이름은 아무 값이나 받는 줄이다", () => {
    expect(rowsOf(ASKING_Q, {})).toEqual([
      { name: "q", kind: "any", required: false, was: "q" },
    ]);
  });

  it("표에 없는 모양(여러 종류)은 화면이 부를 이름이 없어 잠긴 줄이다", () => {
    const schema = { properties: { q: { type: ["string", "number"] } } };
    expect(rowsOf(ASKING_Q, schema)).toEqual([
      { name: "q", kind: "custom", required: false, was: "q" },
    ]);
  });

  it("빈 값(null)도 화면이 고를 수 없는 모양이라 잠긴 줄이다", () => {
    const schema = { properties: { q: { type: "null" } } };
    expect(rowsOf(ASKING_Q, schema)[0].kind).toBe("custom");
  });

  it("이름이 없는 줄은 받는 값이 아니다", () => {
    expect(rowsOf(inputNode({ "  ": "input.x" }), {})).toEqual([]);
  });
});

describe("줄을 문서에 옮겨 적기", () => {
  it("줄을 더하면 그 이름이 곧 값의 자리다 — 처음 모양은 글자다", () => {
    const { config, input_schema } = applyRows(inputNode({}), {}, [
      freshRow({ name: "q" }),
    ]);

    expect(config).toEqual({ bindings: { q: "input.q" } });
    expect(input_schema).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });

  it("종류를 숫자로 바꾸면 받는 자리는 그대로고 모양만 바뀐다", () => {
    const { config, input_schema } = applyRows(ASKING_Q, SCHEMA_Q, [
      row({ kind: "number", required: true }),
    ]);

    expect(config).toEqual({ bindings: { q: "input.q" } });
    expect(input_schema).toEqual({
      type: "object",
      properties: { q: { type: "number" } },
      required: ["q"],
    });
  });

  it("아무 값이나로 바꾸면 문서에서 그 항목도 필수도 사라진다", () => {
    const { config, input_schema } = applyRows(ASKING_Q, SCHEMA_Q, [
      row({ kind: "any", required: true }),
    ]);

    expect(config).toEqual({ bindings: { q: "input.q" } });
    expect(input_schema).toEqual({ type: "object", properties: {} });
  });

  it("꼭 받아요를 켜고 끄면 필수 목록만 오간다", () => {
    const on = applyRows(ASKING_Q, { properties: { q: { type: "string" } } }, [
      row({ required: true }),
    ]);
    expect(on.input_schema.required).toEqual(["q"]);

    const off = applyRows(ASKING_Q, SCHEMA_Q, [row({ required: false })]);
    expect(off.input_schema).not.toHaveProperty("required");
  });

  it("이름을 바꾸면 값의 자리도 항목도 필수도 함께 옮겨 간다", () => {
    const { config, input_schema } = applyRows(ASKING_Q, SCHEMA_Q, [
      row({ name: "question", required: true }),
    ]);

    expect(config).toEqual({ bindings: { question: "input.question" } });
    expect(input_schema).toEqual({
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    });
  });

  it("줄을 지우면 받는 자리도 항목도 필수도 함께 사라진다", () => {
    const { config, input_schema } = applyRows(ASKING_Q, SCHEMA_Q, []);

    expect(config).toEqual({ bindings: {} });
    expect(input_schema).toEqual({ type: "object", properties: {} });
  });

  it("잠긴 줄의 모양은 건드리지 않는다 — 이름만 옮긴다", () => {
    const schema = { properties: { q: { type: ["string", "number"] } } };
    const { input_schema } = applyRows(ASKING_Q, schema, [
      { name: "question", kind: "custom", required: false, was: "q" },
    ]);

    expect(input_schema.properties).toEqual({ question: { type: ["string", "number"] } });
  });

  it("이 노드가 받지 않는 항목은 남의 것이다 — 그대로 둔다", () => {
    const schema = {
      type: "object",
      properties: { q: { type: "string" }, other: { type: "number" } },
      required: ["other"],
    };
    const { input_schema } = applyRows(ASKING_Q, schema, []);

    expect(input_schema).toEqual({
      type: "object",
      properties: { other: { type: "number" } },
      required: ["other"],
    });
  });

  it("줄에 붙어 있던 제목은 종류를 바꿔도 살아 있다", () => {
    const schema = { properties: { q: { type: "string", title: "Question" } } };
    const { input_schema } = applyRows(ASKING_Q, schema, [row({ kind: "list" })]);

    expect(input_schema.properties).toEqual({
      q: { type: "array", title: "Question" },
    });
  });

  it("설정의 다른 값은 이 편집이 건드리지 않는다", () => {
    const node = { ...inputNode({}), config: { bindings: {}, note: "keep me" } } as SpecNode;
    expect(applyRows(node, {}, []).config).toEqual({ bindings: {}, note: "keep me" });
  });
});

// 줄은 제 이름표를 들고 다닌다 (DESIGN §7 input-rows) — 차례가 아니라 이름표로 짝을 찾는다.
describe("다른 줄을 건드렸을 때 내 줄", () => {
  const THREE = inputNode({ q: "input.q", mid: "input.mid", last: "input.last" });
  const THREE_SHAPES: JsonSchema = {
    type: "object",
    properties: {
      q: { type: "string", title: "Q" },
      mid: { type: ["string", "number"] },
      last: { type: "integer", title: "Last" },
    },
    required: ["q", "last"],
  };

  function rowsFrom(schema: JsonSchema = THREE_SHAPES): InputRow[] {
    return rowsOf(THREE, schema);
  }

  /** 문서가 이 이름에 대해 적어 둔 모양. */
  function shapeOf(schema: JsonSchema, name: string): unknown {
    return (schema.properties as Record<string, unknown>)[name];
  }

  it("첫 줄을 지워도 남은 줄의 모양은 글자 하나 바뀌지 않는다", () => {
    const [, ...kept] = rowsFrom();
    const { config, input_schema } = applyRows(THREE, THREE_SHAPES, kept);

    expect(config).toEqual({
      bindings: { mid: "input.mid", last: "input.last" },
    });
    expect(input_schema.properties).toEqual({
      mid: { type: ["string", "number"] },
      last: { type: "integer", title: "Last" },
    });
    expect(input_schema.required).toEqual(["last"]);
  });

  it("가운데 줄을 지워도 잠긴 줄이 옆줄의 모양을 물려받지 않는다", () => {
    const rows = rowsFrom();
    const { input_schema } = applyRows(THREE, THREE_SHAPES, [rows[0], rows[2]]);

    expect(input_schema.properties).toEqual({
      q: { type: "string", title: "Q" },
      last: { type: "integer", title: "Last" },
    });
  });

  it("가운데 줄의 이름만 바꾸면 그 항목 하나만 옮겨 간다", () => {
    const rows = rowsFrom();
    const { input_schema } = applyRows(THREE, THREE_SHAPES, [
      rows[0],
      { ...rows[1], name: "middle" },
      rows[2],
    ]);

    expect(input_schema.properties).toEqual({
      q: { type: "string", title: "Q" },
      middle: { type: ["string", "number"] },
      last: { type: "integer", title: "Last" },
    });
  });

  it("종류를 그대로 둔 줄은 문서의 원문 종류도 그대로다", () => {
    const rows = rowsFrom();
    const { input_schema } = applyRows(THREE, THREE_SHAPES, [
      { ...rows[0], required: false },
      rows[1],
      rows[2],
    ]);

    // `integer`는 화면이 '숫자'라 부르지만, 고쳐 쓰지 않은 줄의 원문은 그대로 남는다.
    expect(shapeOf(input_schema, "last")).toEqual({ type: "integer", title: "Last" });
  });

  it("그 줄의 종류를 정말로 바꾸면 그때는 새 모양이 적힌다", () => {
    const rows = rowsFrom();
    const { input_schema } = applyRows(THREE, THREE_SHAPES, [
      rows[0],
      rows[1],
      { ...rows[2], kind: "text" },
    ]);

    expect(shapeOf(input_schema, "last")).toEqual({ type: "string", title: "Last" });
  });
});

describe("옮겨 적은 것을 다시 읽으면", () => {
  it("적기 전의 줄과 같다 — 새 줄은 이제 제 이름표를 얻는다", () => {
    const rows: InputRow[] = [
      freshRow({ name: "q", kind: "text", required: true }),
      freshRow({ name: "n", kind: "number" }),
      freshRow({ name: "yes", kind: "yesno", required: true }),
      freshRow({ name: "many", kind: "list" }),
      freshRow({ name: "group", kind: "bundle" }),
      freshRow({ name: "free", kind: "any" }),
    ];
    const { config, input_schema } = applyRows(inputNode({}), {}, rows);

    expect(rowsOf({ ...inputNode({}), config } as SpecNode, input_schema)).toEqual(
      rows.map((current) => ({ ...current, was: current.name })),
    );
  });

  it("잠긴 줄도 잠긴 채로 돌아온다", () => {
    const schema = { properties: { q: { type: ["string", "number"] } } };
    const rows: InputRow[] = [{ name: "q", kind: "custom", required: true, was: "q" }];
    const { config, input_schema } = applyRows(ASKING_Q, schema, rows);

    expect(rowsOf({ ...ASKING_Q, config } as SpecNode, input_schema)).toEqual(rows);
  });
});

describe("고를 수 있는 종류", () => {
  it("쉬운 말 표의 종류에 '아무 값이나'를 더한 것이고, 화면이 못 고르는 것은 없다", () => {
    expect(ROW_KINDS).toEqual(["text", "number", "yesno", "list", "bundle", "any"]);
  });
});

// 모양이 없는 값은 필수로 물을 수 없다 (DESIGN §7 input-rows).
describe("아무 값이나 받는 줄과 꼭 받아요", () => {
  it("아무 값이나 받는 줄은 꼭 받게 할 수 없다", () => {
    expect(canBeRequired(row({ kind: "any" }))).toBe(false);
    expect(canBeRequired(row({ kind: "text" }))).toBe(true);
    expect(canBeRequired(row({ kind: "custom" }))).toBe(true);
  });

  it("종류를 아무 값이나로 바꾸면 꼭 받아요도 함께 풀린다", () => {
    expect(withKind(row({ required: true }), "any")).toEqual(
      row({ kind: "any", required: false }),
    );
  });

  it("다른 종류로 바꿀 때는 꼭 받아요를 그대로 둔다", () => {
    expect(withKind(row({ required: true }), "number")).toEqual(
      row({ kind: "number", required: true }),
    );
  });
});

describe("옮겨 적을 수 없는 줄", () => {
  it("이름이 비어 있으면 적지 않는다", () => {
    expect(rowsProblem([row({ name: " " })])).toBe("empty");
  });

  it("같은 이름이 둘이면 적지 않는다", () => {
    expect(rowsProblem([row({ name: "q" }), row({ name: "q" })])).toBe("duplicate");
  });

  it("이름이 저마다 있으면 문제가 없다", () => {
    expect(rowsProblem([row({ name: "q" }), row({ name: "n" })])).toBeUndefined();
  });
});
