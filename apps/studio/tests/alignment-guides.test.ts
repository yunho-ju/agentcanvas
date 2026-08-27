// 노드를 끄는 동안 다른 노드와 줄이 맞는 순간에만 안내선이 선다 (디자인 언어 §2.4, 브리프 A3).
// 계산은 순수 함수 하나가 맡는다 — 화면은 결과를 그리기만 한다.
import { describe, expect, it } from "vitest";
import { SNAP_RANGE, alignmentFor } from "../src/canvas/alignmentGuides";

const box = (x: number, y: number) => ({ x, y, width: 200, height: 100 });

describe("드래그 정렬 안내", () => {
  it("아무 줄도 맞지 않으면 자리를 그대로 두고 안내선도 없다", () => {
    const result = alignmentFor(box(0, 0), [box(500, 500)]);

    expect(result.position).toEqual({ x: 0, y: 0 });
    expect(result.guides).toEqual([]);
  });

  it("왼쪽 변이 코앞이면 그 변에 붙이고 세로 안내선을 세운다", () => {
    const result = alignmentFor(box(504, 900), [box(500, 0)]);

    expect(result.position.x).toBe(500);
    expect(result.guides).toContainEqual({ axis: "x", at: 500 });
  });

  it("가운데끼리가 더 가까우면 가운데를 기준으로 붙인다", () => {
    // 폭이 다른 상대: 왼쪽 변은 4px, 가운데는 1px 차이다 — 더 가까운 쪽이 이긴다.
    const wider = { x: 500, y: 0, width: 210, height: 100 };
    const result = alignmentFor(box(504, 900), [wider]);

    expect(result.position.x).toBe(505);
    expect(result.guides).toContainEqual({ axis: "x", at: 605 });
  });

  it("위아래도 같은 잣대로 본다", () => {
    const result = alignmentFor(box(900, 197), [box(0, 200)]);

    expect(result.position.y).toBe(200);
    expect(result.guides).toContainEqual({ axis: "y", at: 200 });
  });

  it("가로세로가 함께 맞으면 안내선도 함께 선다", () => {
    const result = alignmentFor(box(497, 203), [box(500, 200)]);

    expect(result.position).toEqual({ x: 500, y: 200 });
    expect(result.guides).toHaveLength(2);
  });

  it("한 노드의 오른쪽 변과 다른 노드의 왼쪽 변도 줄이 맞는다", () => {
    // 끄는 노드의 오른쪽 변 = 298 + 200 = 498, 상대의 왼쪽 변 = 500.
    const result = alignmentFor(box(298, 900), [box(500, 0)]);

    expect(result.position.x).toBe(300);
    expect(result.guides).toContainEqual({ axis: "x", at: 500 });
  });

  it("정해진 거리보다 멀면 붙지 않는다", () => {
    const far = SNAP_RANGE + 1;
    const result = alignmentFor(box(500 + far, 900), [box(500, 0)]);

    expect(result.position.x).toBe(500 + far);
    expect(result.guides).toEqual([]);
  });

  it("여러 후보 중 가장 가까운 줄에 붙는다", () => {
    const result = alignmentFor(box(503, 900), [box(500, 0), box(504, 0)]);

    expect(result.position.x).toBe(504);
  });
});
