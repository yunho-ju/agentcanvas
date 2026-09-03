// 받는 줄을 고치는 한 걸음 — 노드의 받는 자리와 문서의 모양이 함께 바뀌고 함께 돌아온다
// (DESIGN §7 input-rows "한 번의 조작 = 되돌리기 한 걸음").
import { beforeEach, describe, expect, it } from "vitest";
import type { InputRow } from "../src/graph/inputRows";
import { rowsOf } from "../src/graph/inputRows";
import { translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { WANTS_BUNDLE, example, exampleWithTool } from "./exampleWithTool";

function store() {
  return useEditor.getState();
}

function inputNode() {
  const node = store().nodes.find((candidate) => candidate.id === "input");
  if (!node) throw new Error("the example has no input node");
  return node;
}

function rows(): InputRow[] {
  return rowsOf(inputNode().data.spec, store().spec?.input_schema);
}

describe("받는 줄 고치기", () => {
  beforeEach(() => {
    store().loadSpec(example);
  });

  it("받는 자리와 문서의 모양을 한 걸음에 함께 바꾼다", () => {
    store().setInputRows("input", [
      { name: "question", kind: "number", required: true, was: "question" },
      { name: "patient_context", kind: "bundle", required: false, was: "patient_context" },
    ]);

    expect(inputNode().data.spec.config?.bindings).toEqual({
      question: "input.question",
      patient_context: "input.patient_context",
    });
    expect(store().spec?.input_schema.properties).toMatchObject({
      question: { type: "number" },
    });
    expect(store().undoStack).toHaveLength(1);
  });

  it("바꾼 종류는 그 자리에서 포트의 모양이 된다", () => {
    store().setInputRows("input", [
      { name: "question", kind: "number", required: true, was: "question" },
      { name: "patient_context", kind: "bundle", required: false, was: "patient_context" },
    ]);

    expect(inputNode().data.ports.outputs.question.schema).toEqual({ type: "number" });
  });

  it("되돌리기 한 번이면 받는 자리도 문서의 모양도 함께 돌아온다", () => {
    const was = rows();

    store().setInputRows("input", [{ name: "asked", kind: "yesno", required: false, was: null }]);
    store().undo();

    expect(rows()).toEqual(was);
    expect(inputNode().data.spec.config?.bindings).toEqual({
      question: "input.question",
      patient_context: "input.patient_context",
    });
    expect(store().spec?.input_schema).toEqual(example.input_schema);
  });

  it("되돌린 걸음은 다시 할 수 있다 — 문서의 모양도 함께 다시 온다", () => {
    store().setInputRows("input", [
      { name: "question", kind: "yesno", required: true, was: "question" },
      { name: "patient_context", kind: "bundle", required: false, was: "patient_context" },
    ]);
    store().undo();
    store().redo();

    expect(store().spec?.input_schema.properties).toMatchObject({
      question: { type: "boolean" },
    });
    expect(rows()[0]).toEqual({
      name: "question",
      kind: "yesno",
      required: true,
      was: "question",
    });
  });

  it("아무것도 달라지지 않은 편집은 되돌릴 걸음을 만들지 않는다", () => {
    store().setInputRows("input", rows());

    expect(store().undoStack).toHaveLength(0);
  });
});

describe("종류를 바꿔 선이 안 맞게 되면", () => {
  beforeEach(() => {
    store().loadSpec(exampleWithTool());
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: WANTS_BUNDLE,
        targetHandle: "input",
      },
      { x: 0, y: 0 },
    );
  });

  it("그 선은 끊기고, 무엇을 잃었는지 그 자리에서 말한다", () => {
    const linked = store().edges.map((edge) => edge.id);
    expect(linked).toContain(`input-${WANTS_BUNDLE}`);

    store().setInputRows("input", [
      { name: "question", kind: "text", required: true, was: "question" },
      { name: "patient_context", kind: "text", required: false, was: "patient_context" },
    ]);

    expect(store().edges.map((edge) => edge.id)).not.toContain(`input-${WANTS_BUNDLE}`);
    expect(translate("ko", store().notice!)).toContain("input");
  });

  it("여전히 맞는 종류로 바꾼 것은 아무 선도 끊지 않는다", () => {
    // 도구의 `input`은 묶음만 받는다 — 묶음으로 두는 한 이 선은 그대로다.
    store().setInputRows("input", [
      { name: "question", kind: "number", required: true, was: "question" },
      { name: "patient_context", kind: "bundle", required: false, was: "patient_context" },
    ]);

    expect(store().edges.map((edge) => edge.id)).toContain(`input-${WANTS_BUNDLE}`);
    expect(store().notice).toBeNull();
  });

  it("되돌리면 끊긴 선도 함께 돌아온다", () => {
    store().setInputRows("input", [
      { name: "question", kind: "text", required: true, was: "question" },
      { name: "patient_context", kind: "text", required: false, was: "patient_context" },
    ]);
    store().undo();

    expect(store().edges.map((edge) => edge.id)).toContain(`input-${WANTS_BUNDLE}`);
  });
});
