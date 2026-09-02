// 새로 놓는 카드의 자리 (DESIGN §7 palette 배치) — 어떤 두 카드도 겹치지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAP_BESIDE, GAP_NEXT, NODE_SIZE, placeNewNode } from "../src/graph/placement";

const tokens = readFileSync(join(process.cwd(), "src/tokens.css"), "utf8");
const appRules = readFileSync(join(process.cwd(), "src/app.css"), "utf8");

function tokenValue(name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1].trim();
}

interface Card {
  id: string;
  position: { x: number; y: number };
}

function card(id: string, x: number, y: number): Card {
  return { id, position: { x, y } };
}

function boxOf(at: { x: number; y: number }) {
  return {
    left: at.x,
    right: at.x + NODE_SIZE.width,
    top: at.y,
    bottom: at.y + NODE_SIZE.height,
  };
}

function overlap(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const one = boxOf(a);
  const other = boxOf(b);
  const wide = Math.min(one.right, other.right) - Math.max(one.left, other.left);
  const tall = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
  return Math.max(0, wide) * Math.max(0, tall);
}

describe("placing a new card", () => {
  it("puts it to the right of the selected card, on the same line", () => {
    const at = placeNewNode({
      nodes: [card("a", 100, 200)],
      selectedId: "a",
      viewportCenter: { x: 0, y: 0 },
    });

    expect(at).toEqual({ x: 100 + NODE_SIZE.width + GAP_BESIDE, y: 200 });
  });

  it("steps down when the place to the right is taken", () => {
    const beside = { x: 100 + NODE_SIZE.width + GAP_BESIDE, y: 200 };
    const at = placeNewNode({
      nodes: [card("a", 100, 200), { id: "b", position: beside }],
      selectedId: "a",
      viewportCenter: { x: 0, y: 0 },
    });

    expect(at).toEqual({ x: beside.x, y: beside.y + NODE_SIZE.height + GAP_NEXT });
  });

  it("uses the size the canvas measured for the selected card, not the token", () => {
    const measured = { id: "a", position: { x: 0, y: 0 }, measured: { width: 400, height: 90 } };

    const at = placeNewNode({
      nodes: [measured],
      selectedId: "a",
      viewportCenter: { x: 0, y: 0 },
    });

    expect(at).toEqual({ x: 400 + GAP_BESIDE, y: 0 });
  });

  it("starts at the middle of what the user is looking at when nothing is selected", () => {
    const at = placeNewNode({
      nodes: [],
      selectedId: null,
      viewportCenter: { x: 640, y: 360 },
    });

    expect(at).toEqual({ x: 640, y: 360 });
  });

  it("steps right from the middle until the place is free", () => {
    const center = { x: 640, y: 360 };
    const at = placeNewNode({
      nodes: [{ id: "a", position: center }],
      selectedId: null,
      viewportCenter: center,
    });

    expect(at).toEqual({ x: center.x + NODE_SIZE.width + GAP_NEXT, y: center.y });
  });

  it("does not look at a selected id that is no longer on the canvas", () => {
    const at = placeNewNode({
      nodes: [],
      selectedId: "gone",
      viewportCenter: { x: 10, y: 20 },
    });

    expect(at).toEqual({ x: 10, y: 20 });
  });

  // 합격 조건(UXQ-5): 팔레트로 세 번 놓아도 어떤 두 카드도 겹치지 않는다.
  it("never overlaps, however many cards are added one after another", () => {
    const placed: Card[] = [];
    for (const id of ["one", "two", "three"]) {
      const at = placeNewNode({
        nodes: placed,
        selectedId: null,
        viewportCenter: { x: 120, y: 120 },
      });
      placed.push({ id, position: at });
    }

    for (const [index, one] of placed.entries()) {
      for (const other of placed.slice(index + 1)) {
        expect(overlap(one.position, other.position)).toBe(0);
      }
    }
  });
});

// 값의 출처는 tokens.css 하나뿐이다 — 여기 적힌 수는 그 토큰의 복사본이고, 어긋나면 여기서 걸린다.
describe("the numbers come from tokens.css", () => {
  it("keeps the card width equal to --node-width", () => {
    expect(tokenValue("--node-width")).toBe(`${NODE_SIZE.width}px`);
  });

  it("keeps the card height equal to --node-height", () => {
    expect(tokenValue("--node-height")).toBe(`${NODE_SIZE.height}px`);
  });

  // 이 숫자는 화면이 쓰는 값이어야 한다 — 코드 안에만 있는 높이는 카드의 높이가 아니다.
  it("is the height the card on the canvas actually keeps", () => {
    const card = appRules.slice(
      appRules.indexOf(".node-card {"),
      appRules.indexOf("}", appRules.indexOf(".node-card {")),
    );

    expect(card).toContain("min-height: var(--node-height)");
  });

  it("keeps the gap beside a selected card equal to --space-6", () => {
    expect(tokenValue("--space-6")).toBe(`${GAP_BESIDE}px`);
  });

  it("keeps the gap to the next free place equal to --space-4", () => {
    expect(tokenValue("--space-4")).toBe(`${GAP_NEXT}px`);
  });
});
