// 피커는 언제 뜨는가 — 연결을 끌다 빈 자리에 놓았을 때, 그리고 빈 캔버스를 두 번 눌렀을 때.
import { describe, expect, it } from "vitest";
import { onEmptyCanvas, pointerPosition, releasedPort } from "../src/canvas/pickerGestures";

const fromResponse = {
  nodeId: "clinical-agent",
  id: "response",
  type: "source" as const,
};

describe("연결을 놓은 자리", () => {
  it("빈 캔버스에 놓았으면 끌고 온 포트를 알려준다", () => {
    expect(
      releasedPort({ isValid: null, toNode: null, fromHandle: fromResponse }),
    ).toEqual({ nodeId: "clinical-agent", portId: "response", side: "source" });
  });

  it("다른 노드 위에 놓았으면 피커를 부르지 않는다", () => {
    // 그 연결은 평소의 잇기가 맡는다 — 피커가 끼어들 자리가 아니다.
    expect(
      releasedPort({ isValid: true, toNode: { id: "output" }, fromHandle: fromResponse }),
    ).toBeNull();
  });

  it("이을 수 없는 포트 위에 놓았어도 피커를 부르지 않는다", () => {
    expect(
      releasedPort({ isValid: false, toNode: { id: "output" }, fromHandle: fromResponse }),
    ).toBeNull();
  });

  it("어느 포트에서 왔는지 모르면 부르지 않는다", () => {
    expect(releasedPort({ isValid: null, toNode: null, fromHandle: null })).toBeNull();
    expect(
      releasedPort({
        isValid: null,
        toNode: null,
        fromHandle: { ...fromResponse, id: null },
      }),
    ).toBeNull();
  });
});

describe("손을 놓은 자리", () => {
  it("마우스는 누른 자리를 그대로 알려준다", () => {
    expect(pointerPosition({ clientX: 120, clientY: 90 })).toEqual({ x: 120, y: 90 });
  });

  it("손가락은 마지막으로 닿은 자리다", () => {
    expect(pointerPosition({ changedTouches: [{ clientX: 12, clientY: 9 }] })).toEqual({
      x: 12,
      y: 9,
    });
  });
});

describe("두 번 누른 자리", () => {
  it("빈 캔버스를 눌렀으면 그 자리다", () => {
    const pane = document.createElement("div");
    pane.className = "react-flow__pane";

    expect(onEmptyCanvas(pane)).toBe(true);
  });

  it("노드나 다른 도구 위를 눌렀으면 그 자리가 아니다", () => {
    const card = document.createElement("div");
    card.className = "node-card";

    expect(onEmptyCanvas(card)).toBe(false);
    expect(onEmptyCanvas(null)).toBe(false);
  });
});
