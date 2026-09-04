// 모양이 새로 놓는 카드가 어디에 앉는가 (순수 함수) — 이을 두 카드의 사이, 차 있으면 비켜난다.
// 이 규칙은 화면의 것이다: 서버에는 뷰포트가 없다 (examples/pattern-anchors는 앵커만 맞춘다).
import { describe, expect, it } from "vitest";
import type { PatchTemplate } from "../src/generated/pattern_def";
import { GAP_ROW, NODE_SIZE, type PlacedCard } from "../src/graph/placement";
import { placeNewNodes } from "../src/graph/patternPlacement";

const VIEWPORT = { x: 0, y: 0, width: 1600, height: 900 };

function link(source: string, target: string) {
  return {
    op: "add_edge" as const,
    kind: "data" as const,
    source: { node: source, port: "out" },
    target: { node: target, port: "in" },
  };
}

function newNodeOp(anchor: string) {
  return { op: "add_node" as const, node: anchor, type: "control.human_gate", config: {} };
}

const BETWEEN: PatchTemplate = [
  newNodeOp("{new:gate}"),
  link("{agent}", "{new:gate}"),
  link("{new:gate}", "{output}"),
];

const ANCHORS = { "{agent}": "agent", "{output}": "output" };

function cards(spots: Record<string, { x: number; y: number }>): PlacedCard[] {
  return Object.entries(spots).map(([id, position]) => ({ id, position }));
}

function hides(one: { x: number; y: number }, other: { x: number; y: number }): boolean {
  return (
    Math.abs(one.x - other.x) < NODE_SIZE.width && Math.abs(one.y - other.y) < NODE_SIZE.height
  );
}

describe("placeNewNodes — 모양이 새로 놓는 카드의 자리", () => {
  // 사이에 낀 카드가 앞뒤 아무 데나 앉으면 선이 서로를 가로지른다 (DESIGN §7 palette 읽는 순서).
  it("값을 보내는 카드 바로 다음 자리, 같은 줄에 앉는다", () => {
    const nodes = cards({ agent: { x: 0, y: 0 }, output: { x: 1000, y: 100 } });

    const spot = placeNewNodes(BETWEEN, ANCHORS, { nodes, viewport: VIEWPORT })["{new:gate}"];

    expect(spot.y).toBe(0);
    expect(spot.x).toBeGreaterThanOrEqual(NODE_SIZE.width);
    for (const card of nodes) expect(hides(spot, card.position)).toBe(false);
  });

  it("그 자리가 차 있으면 그 카드를 가리지 않는 자리로 비켜난다", () => {
    const taken = { x: NODE_SIZE.width + GAP_ROW, y: 0 };
    const nodes = cards({
      agent: { x: 0, y: 0 },
      output: { x: 1000, y: 100 },
      other: taken,
    });

    const spot = placeNewNodes(BETWEEN, ANCHORS, { nodes, viewport: VIEWPORT })["{new:gate}"];

    expect(spot).not.toEqual(taken);
    for (const card of nodes) expect(hides(spot, card.position)).toBe(false);
  });

  it("한 번에 새 카드 둘을 놓아도 서로를 가리지 않는다", () => {
    const twice: PatchTemplate = [
      ...BETWEEN,
      newNodeOp("{new:check}"),
      link("{agent}", "{new:check}"),
      link("{new:check}", "{output}"),
    ];
    const nodes = cards({ agent: { x: 0, y: 0 }, output: { x: 1000, y: 100 } });

    const spots = placeNewNodes(twice, ANCHORS, { nodes, viewport: VIEWPORT });

    expect(Object.keys(spots)).toEqual(["{new:gate}", "{new:check}"]);
    expect(hides(spots["{new:gate}"], spots["{new:check}"])).toBe(false);
  });

  // 값을 보내는 카드가 새 카드일 수도 있다 — 그때도 그 카드 다음에 앉는다.
  it("앞선 새 카드가 값을 보내면 그 카드 다음 줄에 앉는다", () => {
    const chain: PatchTemplate = [
      newNodeOp("{new:gate}"),
      link("{agent}", "{new:gate}"),
      newNodeOp("{new:check}"),
      link("{new:gate}", "{new:check}"),
    ];
    const nodes = cards({ agent: { x: 0, y: 0 }, output: { x: 1000, y: 100 } });

    const spots = placeNewNodes(chain, ANCHORS, { nodes, viewport: VIEWPORT });

    expect(spots["{new:check}"].x).toBeGreaterThan(spots["{new:gate}"].x);
    expect(spots["{new:check}"].y).toBe(spots["{new:gate}"].y);
  });

  // 이을 카드가 하나도 없는 모양은 팔레트가 새 카드를 놓는 그 자리에 앉는다 — 화면 안이 먼저다.
  it("값을 보내는 카드가 없으면 보고 있는 화면 안에 앉는다", () => {
    const alone: PatchTemplate = [newNodeOp("{new:gate}")];

    const spot = placeNewNodes(alone, {}, { nodes: [], viewport: VIEWPORT })["{new:gate}"];

    expect(spot.x).toBeGreaterThanOrEqual(VIEWPORT.x);
    expect(spot.x + NODE_SIZE.width).toBeLessThanOrEqual(VIEWPORT.x + VIEWPORT.width);
    expect(spot.y).toBeGreaterThanOrEqual(VIEWPORT.y);
    expect(spot.y + NODE_SIZE.height).toBeLessThanOrEqual(VIEWPORT.y + VIEWPORT.height);
  });
});
