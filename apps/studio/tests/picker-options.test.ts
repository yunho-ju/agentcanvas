// 포트에서 빈 캔버스로 끌어다 놓으면 뜨는 피커의 목록 (브리프 B4·B5).
// 무엇이 이을 수 있는가는 계약이 정한다 — 이 목록은 checkConnection의 답을 그대로 옮긴다.
import { describe, expect, it } from "vitest";
import { pickerOptions } from "../src/canvas/pickerOptions";
import type { AgentSpec } from "../src/generated/agent_spec";
import { nodeTypes } from "../src/registry/registry";
import { WANTS_BUNDLE, example as spec, exampleWithTool } from "./exampleWithTool";

function typesFor(
  from: Parameters<typeof pickerOptions>[0]["from"],
  query = "",
  doc: AgentSpec = spec,
) {
  return pickerOptions({ spec: doc, from, query, locale: "ko" }).map(
    (option) => option.type,
  );
}

/** 'clinical-agent'의 response 포트는 글자를 내보낸다. */
const sendsText = { nodeId: "clinical-agent", portId: "response", side: "source" } as const;
/** 'clinical-agent'의 messages 포트는 무엇이든 받는다 (DESIGN §7 port-schema). */
const wantsAnything = { nodeId: "clinical-agent", portId: "messages", side: "target" } as const;
/** 도구의 input 포트는 묶음만 받는다 — 이 문서에서 종류를 정말로 가리는 자리다. */
const wantsBundle = { nodeId: WANTS_BUNDLE, portId: "input", side: "target" } as const;

describe("노드 피커의 목록", () => {
  it("끌고 온 포트가 없으면 등록된 모든 종류를 보여준다", () => {
    expect(typesFor(null)).toEqual(Object.keys(nodeTypes));
  });

  it("내보내는 포트에서 끌고 오면 그 값을 받을 수 있는 종류만 남는다", () => {
    const types = typesFor(sendsText);

    expect(types).toContain("core.output");
    expect(types).toContain("control.human_gate");
    // 무엇이든 받는 자리(llm.agent.messages)에는 글자도 들어가지만,
    // 묶음만 받는 자리(tool.mcp.input)에는 들어가지 않는다.
    expect(types).toContain("llm.agent");
    expect(types).not.toContain("tool.mcp");
  });

  it("받는 포트에서 끌고 오면 그 값을 내보낼 수 있는 종류만 남는다", () => {
    const types = typesFor(wantsBundle, "", exampleWithTool());

    // 도구는 묶음을 내보낼 수 있지만, AI 에이전트는 글자와 목록만 내보낸다.
    expect(types).toContain("tool.mcp");
    expect(types).not.toContain("llm.agent");
    // 받기만 하는 종류는 애초에 내보낼 자리가 없다.
    expect(types).not.toContain("core.output");
  });

  it("이을 자리가 아예 없는 종류는 목록에 오르지 않는다", () => {
    // 입력 노드는 설정을 채우기 전까지 내보내는 자리가 없다.
    expect(typesFor(wantsAnything)).not.toContain("core.input");
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
    // 'AI 에이전트'는 이름으로는 맞지만 묶음을 내보내지 못한다.
    expect(typesFor(wantsBundle, "AI", exampleWithTool())).toEqual([]);
  });

  it("찾는 이름은 화면의 언어로 읽는다", () => {
    const english = pickerOptions({ spec, from: null, query: "check", locale: "en" });

    expect(english.map((option) => option.type)).toEqual(["control.human_gate"]);
    expect(typesFor(null, "check")).toEqual([]);
  });
});
