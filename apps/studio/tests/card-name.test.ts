// 카드를 부르는 이름은 한 곳에서 정한다 — 카드·설정 패널·목록·서랍·저장 소식이 같은 말을 쓴다.
import { describe, expect, it } from "vitest";
import { cardName, cardTitle } from "../src/graph/cardName";
import type { AgentNodeData } from "../src/graph/serialize";

function data(displayName?: Record<"ko" | "en", string>): AgentNodeData {
  return {
    spec: { id: "agent", type: "llm.agent", position: { x: 0, y: 0 } },
    nodeType: displayName
      ? ({ display_name: displayName } as AgentNodeData["nodeType"])
      : undefined,
    ports: { inputs: {}, outputs: {} },
  };
}

describe("카드를 부르는 이름", () => {
  it("등록부가 준 이름을 두 언어 그대로 들고 다닌다", () => {
    const name = { ko: "AI 에이전트", en: "AI agent" };

    expect(cardName(data(name))).toEqual(name);
    expect(cardTitle(data(name), "ko")).toBe("AI 에이전트");
    expect(cardTitle(data(name), "en")).toBe("AI agent");
  });

  it("등록부가 모르는 종류는 종류 이름으로 부른다", () => {
    expect(cardName(data())).toBe("llm.agent");
    expect(cardTitle(data(), "ko")).toBe("llm.agent");
  });

  it("한 언어라도 이름이 비었으면 종류 이름으로 부른다 — 빈 제목을 내보이지 않는다", () => {
    expect(cardName(data({ ko: "", en: "AI agent" }))).toBe("llm.agent");
    expect(cardTitle(data({ ko: "", en: "AI agent" }), "en")).toBe("llm.agent");
  });
});
