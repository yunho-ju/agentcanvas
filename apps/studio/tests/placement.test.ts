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

const SEEN = { width: 1440, height: 900 };

/** 그 점을 한가운데로 보고 있는 화면 — 옛 시험이 말하던 '보고 있는 한가운데'와 같은 자리다. */
function seenAround(middle: { x: number; y: number }) {
  return {
    x: middle.x - SEEN.width / 2,
    y: middle.y - SEEN.height / 2,
    ...SEEN,
  };
}

/** 카드 중심이 화면 한가운데에 오는 자리 — 첫 카드는 여기 선다 (DESIGN §7 palette). */
function centredIn(
  view: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number } = NODE_SIZE,
) {
  return {
    x: view.x + view.width / 2 - size.width / 2,
    y: view.y + view.height / 2 - size.height / 2,
  };
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
      viewport: seenAround({ x: 0, y: 0 }),
    });

    expect(at).toEqual({ x: 100 + NODE_SIZE.width + GAP_BESIDE, y: 200 });
  });

  it("steps down when the place to the right is taken", () => {
    const beside = { x: 100 + NODE_SIZE.width + GAP_BESIDE, y: 200 };
    const at = placeNewNode({
      nodes: [card("a", 100, 200), { id: "b", position: beside }],
      selectedId: "a",
      viewport: seenAround({ x: 0, y: 0 }),
    });

    expect(at).toEqual({ x: beside.x, y: beside.y + NODE_SIZE.height + GAP_NEXT });
  });

  it("uses the size the canvas measured for the selected card, not the token", () => {
    const measured = { id: "a", position: { x: 0, y: 0 }, measured: { width: 400, height: 90 } };

    const at = placeNewNode({
      nodes: [measured],
      selectedId: "a",
      viewport: seenAround({ x: 0, y: 0 }),
    });

    expect(at).toEqual({ x: 400 + GAP_BESIDE, y: 0 });
  });

  // 카드의 중심이 화면 한가운데에 온다 — 좌상단을 한가운데에 두면 카드가 오른쪽으로 치우친다.
  it("centres the first card on the middle of what the user is looking at", () => {
    const seen = seenAround({ x: 640, y: 360 });

    const at = placeNewNode({ nodes: [], selectedId: null, viewport: seen });

    expect(at).toEqual(centredIn(seen));
  });

  // 가운데 칸이 차 있으면 그 줄에서 오른쪽으로 차례로 — 흐름은 읽는 순서대로 늘어선다
  // (DESIGN §7 palette '순서는 흐름 방향을 따른다').
  it("fills the middle row rightwards when the middle cell is taken", () => {
    const seen = seenAround({ x: 640, y: 360 });
    const first = centredIn(seen);

    const at = placeNewNode({
      nodes: [{ id: "a", position: first }],
      selectedId: null,
      viewport: seen,
    });

    expect(at).toEqual({ x: first.x + NODE_SIZE.width + GAP_NEXT, y: first.y });
  });

  it("does not look at a selected id that is no longer on the canvas", () => {
    const seen = seenAround({ x: 10, y: 20 });

    const at = placeNewNode({ nodes: [], selectedId: "gone", viewport: seen });

    expect(at).toEqual(centredIn(seen));
  });

  // reviewer major 2: 옆자리가 차 있는지도 추정 크기(가장 넓은 실측)로 본다 — 토큰 폭으로 보면
  // 416px 카드 b(700)와 164px 겹치는 {448, 400}을 돌려준다.
  it("steps down past a measured card the token width would have overlapped", () => {
    const wide = { width: 416, height: 48 };
    const a = { id: "a", position: { x: 0, y: 400 }, measured: wide };
    const b = { id: "b", position: { x: 700, y: 400 }, measured: wide };

    const at = placeNewNode({ nodes: [a, b], selectedId: "a", viewport: seenAround({ x: 720, y: 450 }) });

    expect(at).toEqual({ x: 416 + GAP_BESIDE, y: 400 + wide.height + GAP_NEXT });
  });

  // 합격 조건(UXQ-5): 팔레트로 세 번 놓아도 어떤 두 카드도 겹치지 않는다.
  it("never overlaps, however many cards are added one after another", () => {
    const placed: Card[] = [];
    for (const id of ["one", "two", "three"]) {
      const at = placeNewNode({
        nodes: placed,
        selectedId: null,
        viewport: seenAround({ x: 120, y: 120 }),
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

// 화면 안이 먼저다 (DESIGN §7 palette, UXQ2-6) — 연달아 놓아도 먼저 놓은 카드가 화면 밖으로 밀리지 않는다.
describe("화면 안이 먼저다", () => {
  const VIEW = { x: 0, y: 0, width: 1440, height: 900 };

  /** 줄 하나가 화면 폭 안에 들어오는가 — 가장 왼쪽 카드의 왼쪽 끝부터 가장 오른쪽 카드의 오른쪽 끝까지. */
  function rowSpan(cards: { position: { x: number; y: number } }[], width = NODE_SIZE.width) {
    const lefts = cards.map((one) => one.position.x);
    return Math.max(...lefts) + width - Math.min(...lefts);
  }

  function ascending(cards: { position: { x: number; y: number } }[]): boolean {
    return cards.every((one, index) => index === 0 || cards[index - 1].position.x < one.position.x);
  }

  /** 오른쪽 자리(1540)가 화면 밖으로 나가는, 오른쪽 끝에 선 카드. */
  const atTheEdge = card("a", 1300, 400);
  /** 그 줄의 왼쪽 끝 — 이 카드가 있으면 줄(0 → 1748)이 화면 폭을 넘는다. */
  const atTheFarLeft = card("far", 0, 400);

  // 줄이 화면 폭을 넘을 때만 그 자리를 버린다 — 넘지 않으면 아래 '줄이 화면 폭에 들어오는 한'이 든다.
  it("그 줄이 화면 폭을 넘으면 그 자리 대신 화면 안의 빈 자리, 가운데 칸에 놓는다", () => {
    const at = placeNewNode({
      nodes: [atTheFarLeft, atTheEdge],
      selectedId: "a",
      viewport: VIEW,
    });

    expect(at).toEqual(centredIn(VIEW));
  });

  // 줄이 화면 폭에 들어오는 한 오른쪽을 유지한다 (DESIGN §7 palette '화면 안이 먼저다') —
  // 캔버스가 최소로 따라가고, 먼저 놓은 카드는 그대로 보인다. 읽는 순서가 먼저다.
  it("오른쪽 자리가 화면 밖이어도 줄이 화면 폭에 들어오면 그대로 오른쪽에 놓는다", () => {
    const at = placeNewNode({ nodes: [atTheEdge], selectedId: "a", viewport: VIEW });

    expect(at).toEqual({ x: 1300 + NODE_SIZE.width + GAP_BESIDE, y: 400 });
  });

  // 합격 조건(UXQ2-6): 세 장을 연달아 놓으면 세 장이 한 줄에 읽는 순서로 서고, 그 줄이 화면 폭
  // (--space-4 하나를 뺀)에 들어온다 — 세 번째는 캔버스가 최소로 따라간 뒤 보인다.
  it("연달아 세 장을 놓으면 한 줄에 읽는 순서로 서고 줄이 화면 폭에 들어온다", () => {
    const placed: Card[] = [];
    let selectedId = atTheEdge.id;
    for (const id of ["input", "agent", "output"]) {
      const at = placeNewNode({
        nodes: [atTheEdge, ...placed],
        selectedId,
        viewport: VIEW,
      });
      placed.push({ id, position: at });
      // 방금 놓은 카드를 고른 채로 다음 장을 놓는다 — 한쪽으로 걸어 나가던 그 걸음이다.
      selectedId = id;
    }

    const row = [atTheEdge, ...placed];
    expect(row.every((one) => one.position.y === atTheEdge.position.y)).toBe(true);
    expect(ascending(row)).toBe(true);
    expect(rowSpan(row)).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
  });

  // 사람이 브라우저에서 겪은 그대로(1440x900): 첫 장은 선택 없이 한가운데, 그다음부터는
  // 방금 놓은 카드를 고른 채로 연달아 놓는다. 다섯 장이 한 줄에 읽는 순서로 서고, 줄이 화면 폭에
  // 들어오니 캔버스가 최소로 따라가도 첫 카드가 독 뒤로 밀리지 않는다.
  it("다섯 장을 연달아 놓아도 한 줄에 읽는 순서로 서고 줄이 화면 폭에 들어온다", () => {
    const placed: Card[] = [];
    let selectedId: string | null = null;
    for (const id of ["input", "agent", "output", "fourth", "fifth"]) {
      const at = placeNewNode({ nodes: [...placed], selectedId, viewport: VIEW });
      placed.push({ id, position: at });
      selectedId = id;
    }

    const first = centredIn(VIEW);
    expect(placed.every((one) => one.position.y === first.y)).toBe(true);
    expect(ascending(placed)).toBe(true);
    expect(rowSpan(placed)).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
  });

  // 실제 앱에서 팔레트로 놓은 카드는 선택되지 않는다 — 그래서 매번 '선택 없음' 규칙을 탄다.
  // 사람이 브라우저에서 겪은 그대로: 아무것도 고르지 않은 채 다섯 장을 연달아 놓는다.
  it("아무것도 고르지 않고 다섯 장을 놓으면 한 줄로 읽는 순서대로 늘어선다", () => {
    const step = NODE_SIZE.width + GAP_NEXT;
    const first = centredIn(VIEW);
    const placed: Card[] = [];
    for (const id of ["input", "agent", "output", "fourth", "fifth"]) {
      const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: VIEW });
      placed.push({ id, position: at });
    }

    // 가운데 칸에서 오른쪽으로 차례로(Input→Agent→Output→…) — 줄이 화면 폭에 들어오는 한 오른쪽을
    // 지킨다(DESIGN §7 palette '놓이는 자리'). 넷째부터는 화면 밖이어도 캔버스가 최소로 따라간다.
    expect(placed.map((one) => one.position)).toEqual(
      [0, 1, 2, 3, 4].map((column) => ({ x: first.x + column * step, y: first.y })),
    );
    expect(rowSpan(placed)).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
  });

  // 회송 UXQ2-9: 보이는 폭이 한 장 분량이면 줄마다 칸이 하나뿐이라 줄 순서 자체가 드러난다.
  // 아래·위를 번갈아 잡으면 셋째 카드가 첫 카드 위에 서서 읽는 순서가 깨진다.
  describe("격자 탐색은 세로로 감길 때도 읽는 순서다", () => {
    const ONE_COLUMN = { x: 0, y: 0, width: 240, height: 900 };

    it("세 장을 놓으면 위→아래로 y가 오름차순으로 늘어선다", () => {
      const step = NODE_SIZE.height + GAP_NEXT;
      const first = centredIn(ONE_COLUMN);
      const placed: Card[] = [];
      for (const id of ["input", "agent", "output"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: ONE_COLUMN });
        placed.push(card(id, at.x, at.y));
      }

      expect(placed.map((one) => one.position)).toEqual(
        [0, 1, 2].map((row) => ({ x: first.x, y: first.y + row * step })),
      );
    });

    it("아래 줄이 아직 남아 있으면 위 줄로 가지 않는다", () => {
      // 높이를 줄여 아래로 갈 수 있는 줄을 가운데 포함 셋으로 못 박는다.
      const view = { x: 0, y: 0, width: 240, height: 304 };
      const step = NODE_SIZE.height + GAP_NEXT;
      const first = centredIn(view);
      const placed: Card[] = [];
      for (const id of ["one", "two", "three"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: view });
        placed.push(card(id, at.x, at.y));
      }

      // 아래로 내려갈 줄이 아직 둘 남았을 때도(첫 장을 놓은 다음부터) 위로 가지 않는다.
      expect(placed.map((one) => one.position)).toEqual(
        [0, 1, 2].map((row) => ({ x: first.x, y: first.y + row * step })),
      );

      // 아래 줄이 다 찬 뒤에야 위 줄로 간다.
      const fourth = placeNewNode({ nodes: placed, selectedId: null, viewport: view });
      expect(fourth).toEqual({ x: first.x, y: first.y - step });
    });
  });

  it("가운데 줄이 다 차고 줄이 화면 폭을 넘으면 아래 줄로 내려간다 — 위가 아니라 아래가 먼저다", () => {
    const step = NODE_SIZE.width + GAP_NEXT;
    const first = centredIn(VIEW);
    // 화면 안 다섯 칸이 다 찼고, 왼쪽 밖에 한 장 더 있어 줄(-56 → 1496)이 화면 폭을 넘는다.
    const wholeRow = [-3, -2, -1, 0, 1, 2].map((column) =>
      card(`full${column}`, first.x + column * step, first.y),
    );

    const at = placeNewNode({ nodes: wholeRow, selectedId: null, viewport: VIEW });

    expect(at).toEqual({ x: first.x, y: first.y + NODE_SIZE.height + GAP_NEXT });
  });

  // 카드는 토큰보다 넓게 그려진다(브라우저에서 416px) — 격자가 카드보다 촘촘하면 간격이 --space-4에
  // 맞지 않고, 화면 밖으로 삐져나온 채 '안에 있다'고 잘못 세게 된다 (DESIGN §7 palette).
  describe("격자 칸은 이미 놓인 카드의 실제 크기로 잰다", () => {
    const WIDE = { width: 416, height: 48 };

    function wideCard(id: string, x: number, y: number, size = WIDE) {
      return { id, position: { x, y }, measured: size };
    }

    it("가로 칸은 가장 넓은 카드 + --space-4다", () => {
      const first = centredIn(VIEW, WIDE);

      const at = placeNewNode({
        nodes: [wideCard("a", first.x, first.y)],
        selectedId: null,
        viewport: VIEW,
      });

      expect(at).toEqual({ x: first.x + WIDE.width + GAP_NEXT, y: first.y });
    });

    // 넓은 카드(416px)도 한 줄에 셋이 선다 — 가운데(512)에서 오른쪽(944)으로, 그다음도 오른쪽(1376):
    // 셋째는 화면 밖이지만 줄(512 → 1792)이 화면 폭에 들어오니 캔버스가 최소로 따라간다.
    it("416px 카드 세 장이 한 줄에 나란히 선다", () => {
      const step = WIDE.width + GAP_NEXT;
      const first = centredIn(VIEW, WIDE);
      const placed = [wideCard("input", first.x, first.y)];
      for (const id of ["agent", "output"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: VIEW });
        placed.push(wideCard(id, at.x, at.y));
      }

      expect(placed.map((one) => one.position)).toEqual([
        { x: first.x, y: first.y },
        { x: first.x + step, y: first.y },
        { x: first.x + 2 * step, y: first.y },
      ]);
      expect(rowSpan(placed, WIDE.width)).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
    });

    // 빈 캔버스의 첫 장은 아직 잰 카드가 없어 토큰 칸(616)에 선다. 그다음부터는 가운데 줄의
    // 가장 오른쪽 카드 옆이라 격자와 어긋나도 한 줄에 읽는 순서로 선다.
    it("빈 캔버스에서 시작해도 세 장이 한 줄에 읽는 순서로 선다", () => {
      const placed: ReturnType<typeof wideCard>[] = [];
      for (const id of ["input", "agent", "output"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: VIEW });
        placed.push(wideCard(id, at.x, at.y));
      }

      const first = centredIn(VIEW);
      expect(placed.map((one) => one.position)).toEqual(
        [0, 1, 2].map((column) => ({ x: first.x + column * (WIDE.width + GAP_NEXT), y: first.y })),
      );
      expect(rowSpan(placed, WIDE.width)).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
    });

    // 줄 유지 판정도 같은 추정치다 — 토큰 폭(208)으로 재면 줄(80 → 1356)이 들어오지만 실측(416)으로는
    // 넘친다(80 → 1564). 넘치는 줄은 격자 탐색이다: 가운데 줄은 다 찼으니 아래 줄 가운데 칸.
    it("줄 유지 판정은 토큰이 아니라 가장 넓은 실측 폭으로 잰다", () => {
      const first = centredIn(VIEW, WIDE);
      const nodes = [wideCard("a", 80, first.y), wideCard("r", 700, first.y)];

      const at = placeNewNode({ nodes, selectedId: "r", viewport: VIEW });

      expect(at).toEqual({ x: first.x, y: first.y + WIDE.height + GAP_NEXT });
    });

    // 사람이 브라우저에서 겪은 그대로(줌 2배 — 보이는 flow 폭 720, 카드 실측 폭 208·227.5·219).
    // 팔레트로 놓은 카드는 선택되지 않아 매번 '선택 없음' 경로다: 셋째가 첫 카드 왼쪽(363.5)에 서던 자리.
    describe("줌 2배 화면에서 선택 없이 연달아 놓는다", () => {
      const ZOOMED = { x: 360, y: 225, width: 720, height: 450 };
      const MEASURED = [208, 227.5, 219];

      function threeInARow() {
        const placed: ReturnType<typeof wideCard>[] = [];
        for (const [index, id] of ["input", "agent", "output"].entries()) {
          const at = placeNewNode({ nodes: [...placed], selectedId: null, viewport: ZOOMED });
          placed.push(wideCard(id, at.x, at.y, { width: MEASURED[index], height: 48 }));
        }
        return placed;
      }

      it("세 장이 한 줄에 읽는 순서로 서고 줄이 화면 폭에 들어온다 — 셋째는 화면 밖이어도 된다", () => {
        const placed = threeInARow();

        const [input, agent, output] = placed;
        expect(placed.every((one) => one.position.y === input.position.y)).toBe(true);
        expect(ascending(placed)).toBe(true);
        // 가장 오른쪽 카드 옆 --space-4, 그 카드의 실측 폭 기준.
        expect(agent.position.x).toBe(input.position.x + 208 + GAP_NEXT);
        expect(output.position.x).toBe(agent.position.x + 227.5 + GAP_NEXT);
        const span = output.position.x + 219 - input.position.x;
        expect(span).toBeLessThanOrEqual(ZOOMED.width - GAP_NEXT);
      });

      // 넷째는 줄이 화면 폭을 넘는다 — 그때만 격자 탐색이다. 캔버스는 셋째를 보이도록 최소로
      // (넘친 만큼 + --space-4) 따라가 있으므로, 그 화면의 가운데 줄은 다 차 있고 아래 줄 가운데 칸이 빈다.
      it("네 번째 카드는 줄이 화면 폭을 넘으니 아래 줄 가운데 칸으로 간다", () => {
        const placed = threeInARow();
        const output = placed[2];
        const overflow = output.position.x + 219 - (ZOOMED.x + ZOOMED.width);
        expect(overflow).toBeGreaterThan(0);
        const followed = { ...ZOOMED, x: ZOOMED.x + overflow + GAP_NEXT };

        const at = placeNewNode({ nodes: placed, selectedId: null, viewport: followed });

        // 격자 칸은 가장 넓은 카드(227.5)로 잰다.
        const widest = { width: 227.5, height: 48 };
        const middle = centredIn(followed, widest);
        expect(at).toEqual({ x: middle.x, y: middle.y + widest.height + GAP_NEXT });
      });
    });

    // 사람이 브라우저에서 겪은 그대로(1440x900, Input→AI agent→Output, 방금 놓은 카드를 고른 채로).
    // 세 번째 카드가 첫 카드 왼쪽(x=16)에 서던 그 자리다 — 이제 줄이 화면 폭에 들어오는 한 오른쪽이다.
    it("416px 카드를 고른 채로 세 장을 놓으면 한 줄에 읽는 순서로 선다 — 세 번째는 화면 밖이어도 된다", () => {
      const placed: ReturnType<typeof wideCard>[] = [];
      let selectedId: string | null = null;
      for (const id of ["input", "agent", "output"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId, viewport: VIEW });
        placed.push(wideCard(id, at.x, at.y));
        selectedId = id;
      }

      const [input, agent, output] = placed;
      expect(placed.every((one) => one.position.y === input.position.y)).toBe(true);
      expect(input.position.x).toBeLessThan(agent.position.x);
      expect(agent.position.x).toBeLessThan(output.position.x);
      const span = output.position.x + WIDE.width - input.position.x;
      expect(span).toBeLessThanOrEqual(VIEW.width - GAP_NEXT);
    });

    // 네 번째는 줄이 화면 폭을 넘는다 — 그때만 격자 탐색이다. 캔버스는 세 번째 카드를 보이도록
    // 최소로(넘친 만큼 + --space-4) 따라가 있으므로, 그 화면의 가운데 줄은 다 차 있고 아래 줄 가운데 칸이 빈다.
    it("네 번째 카드는 줄이 화면 폭을 넘으니 아래 줄 가운데 칸으로 간다", () => {
      const placed: ReturnType<typeof wideCard>[] = [];
      let selectedId: string | null = null;
      for (const id of ["input", "agent", "output"]) {
        const at = placeNewNode({ nodes: [...placed], selectedId, viewport: VIEW });
        placed.push(wideCard(id, at.x, at.y));
        selectedId = id;
      }
      const output = placed[2];
      const overflow = output.position.x + WIDE.width - (VIEW.x + VIEW.width);
      expect(overflow).toBeGreaterThan(0);
      const followed = { ...VIEW, x: VIEW.x + overflow + GAP_NEXT };

      const at = placeNewNode({ nodes: [...placed], selectedId, viewport: followed });

      const middle = centredIn(followed, WIDE);
      expect(at).toEqual({ x: middle.x, y: middle.y + WIDE.height + GAP_NEXT });
    });

    it("세로 칸은 가장 높은 카드 + --space-4다", () => {
      const tall = { width: 416, height: 90 };
      const first = centredIn(VIEW, tall);
      const step = tall.width + GAP_NEXT;
      const rowTaken = [-1, 0, 1].map((column) =>
        wideCard(`full${column}`, first.x + column * step, first.y, tall),
      );

      const at = placeNewNode({ nodes: rowTaken, selectedId: null, viewport: VIEW });

      expect(at).toEqual({ x: first.x, y: first.y + tall.height + GAP_NEXT });
    });
  });

  // 오른쪽만 살피면 오른쪽이 찼을 때 화면 밖으로 나간다 — 격자는 왼쪽도 살핀다.
  it("줄이 화면 폭을 넘고 오른쪽이 찼으면 가운데 왼쪽의 빈 자리를 쓴다", () => {
    // 카드 한 줄만 들어가는 화면 — 위아래로 갈 곳이 없으니 왼쪽으로 가는지가 드러난다.
    const oneRow = { x: 0, y: 0, width: 1440, height: 100 };
    const first = centredIn(oneRow);
    const step = NODE_SIZE.width + GAP_NEXT;
    const takenRight = [0, 1, 2].map((column) =>
      card(`full${column}`, first.x + column * step, first.y),
    );
    // 왼쪽 두 칸 너머의 카드 — 이 카드부터 오른쪽 자리(1540)까지의 줄이 화면 폭을 넘는다.
    const farLeft = card("far", first.x - 2 * step, first.y);
    const edge = card("a", 1300, 50);

    const at = placeNewNode({
      nodes: [edge, farLeft, ...takenRight],
      selectedId: "a",
      viewport: oneRow,
    });

    expect(at).toEqual({ x: first.x - step, y: first.y });
  });

  it("화면 안에 빈 자리가 없으면 예전 그대로 오른쪽에 놓는다 (캔버스가 데리러 간다)", () => {
    // 한 줄짜리 화면을 격자 자리마다 카드로 채운다 — 이제 정말 빈 자리가 없다.
    const oneRow = { x: 0, y: 0, width: 1440, height: 100 };
    const first = centredIn(oneRow);
    const step = NODE_SIZE.width + GAP_NEXT;
    const edge = card("a", 1300, 50);
    const full = [
      edge,
      ...[-2, -1, 0, 1, 2].map((column) =>
        card(`full${column}`, first.x + column * step, first.y),
      ),
    ];

    const at = placeNewNode({ nodes: full, selectedId: "a", viewport: oneRow });

    expect(at).toEqual({ x: 1300 + NODE_SIZE.width + GAP_BESIDE, y: 50 });
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
