// 표식(x-enabled-when)이 잠근 칸은 정말로 잠긴다 — 받는 척만 하는 편집기를 두지 않는다
// (DESIGN §7 agent-turns). 어떤 편집기가 새로 와도 이 표를 지나야 한다.
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { CONTROLS } from "../src/inspector/controls";
import type { ControlKind, FormField } from "../src/inspector/schemaForm";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  store().loadSpec(example);
  // 문서의 것을 읽는 편집기들이 그릴 줄을 갖도록 — 빈 목록은 아무것도 증명하지 않는다.
  store().select("node", "clinical-agent");
});

function fieldOf(control: ControlKind): FormField {
  return {
    name: "toolset_refs",
    label: { ko: "칸", en: "Field" },
    required: false,
    control,
    options: ["a", "b"],
    schema: { type: "string" },
  };
}

describe("every editor a locked field can land on", () => {
  it.each(Object.keys(CONTROLS) as ControlKind[])("puts %s out of reach", (control) => {
    const { Component } = CONTROLS[control];
    const { container } = render(
      <ReactFlowProvider>
        <Component
          field={fieldOf(control)}
          value={["clinical-reference"]}
          onChange={() => undefined}
          id="config-x"
          invalid={false}
          disabled
          title="지금은 고칠 수 없어요"
        />
      </ReactFlowProvider>,
    );

    const hands = container.querySelectorAll("input, select, textarea, button");
    expect(hands.length).toBeGreaterThan(0);
    for (const hand of hands) expect(hand).toBeDisabled();
  });
});
