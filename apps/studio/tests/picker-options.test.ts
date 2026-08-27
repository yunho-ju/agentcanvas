// 포트에서 빈 캔버스로 끌어다 놓으면 뜨는 피커의 목록 (브리프 B4·B5).
// 무엇이 이을 수 있는가는 계약이 정한다 — 이 목록은 checkConnection의 답을 그대로 옮긴다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { pickerOptions } from "../src/canvas/pickerOptions";
import type { AgentSpec } from "../src/generated/agent_spec";
import { nodeTypes } from "../src/registry/registry";

const spec = exampleSpec as unknown as AgentSpec;

function typesFor(from: Parameters<typeof pickerOptions>[0]["from"], query = "") {
  return pickerOptions({ spec, from, query, locale: "ko" }).map((option) => option.type);
}

/** 'clinical-agent'의 response 포트는 글자를 내보낸다. */
const sendsText = { nodeId: "clinical-agent", portId: "response", side: "source" } as const;
/** 'clinical-agent'의 messages 포트는 목록을 받는다. */
const wantsList = { nodeId: "clinical-agent", portId: "messages", side: "target" } as const;

describe("노드 피커의 목록", () => {
  it("끌고 온 포트가 없으면 등록된 모든 종류를 보여준다", () => {
    expect(typesFor(null)).toEqual(Object.keys(nodeTypes));
  });

  it("내보내는 포트에서 끌고 오면 그 값을 받을 수 있는 종류만 남는다", () => {
    const types = typesFor(sendsText);

    expect(types).toContain("core.output");
    expect(types).toContain("control.human_gate");
    // 목록을 받는 자리(messages)에도, 묶음을 받는 자리(tool.mcp.input)에도 글자는 들어가지 않는다.
    expect(types).not.toContain("llm.agent");
    expect(types).not.toContain("tool.mcp");
  });

  it("받는 포트에서 끌고 오면 그 값을 내보낼 수 있는 종류만 남는다", () => {
    const types = typesFor(wantsList);

    expect(types).toContain("llm.agent");
    expect(types).not.toContain("core.output");
  });

  it("이을 자리가 아예 없는 종류는 목록에 오르지 않는다", () => {
    // 입력 노드는 설정을 채우기 전까지 내보내는 자리가 없다.
    expect(typesFor(wantsList)).not.toContain("core.input");
  });

  it("고르면 어느 자리에 이어질지까지 함께 알려준다", () => {
    const option = pickerOptions({ spec, from: sendsText, query: "", locale: "ko" }).find(
      (candidate) => candidate.type === "control.human_gate",
    );

    expect(option?.port).toBe("review");
  });

  it("연결 없이 열었을 때는 이어질 자리가 없다", () => {
    const option = pickerOptions({ spec, from: null, query: "", locale: "ko" })[0];

    expect(option.port).toBeUndefined();
  });

  it("이름으로 찾는다", () => {
    expect(typesFor(null, "출력")).toEqual(["core.output"]);
  });

  it("종류 이름으로도 찾는다 — 사용자가 아는 이름이 하나가 아니다", () => {
    expect(typesFor(null, "tool.")).toEqual(["tool.mcp"]);
  });

  it("대소문자와 앞뒤 공백은 넘어가 준다", () => {
    expect(typesFor(null, "  TOOL.MCP ")).toEqual(["tool.mcp"]);
  });

  it("찾는 말과 이을 수 있는지를 함께 본다", () => {
    // '출력'은 이름으로는 맞지만 목록을 내보내지 못한다.
    expect(typesFor(wantsList, "출력")).toEqual([]);
  });

  it("찾는 이름은 화면의 언어로 읽는다", () => {
    const english = pickerOptions({ spec, from: null, query: "check", locale: "en" });

    expect(english.map((option) => option.type)).toEqual(["control.human_gate"]);
    expect(typesFor(null, "check")).toEqual([]);
  });
});
