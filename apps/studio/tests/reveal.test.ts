// 새로 놓은 카드가 화면 밖이면 화면이 그만큼만 따라간다 (DESIGN §7 palette 배치 — pan-to-reveal).
import { describe, expect, it } from "vitest";
import { revealMove } from "../src/canvas/reveal";

// 1440×900 화면, 여백은 --space-4(16px).
const seen = { x: 0, y: 0, width: 1440, height: 900 };
const margin = 16;

describe("보이게 하는 최소 이동", () => {
  it("이미 온전히 보이는 카드에는 아무 말도 하지 않는다", () => {
    expect(revealMove(seen, { x: 200, y: 200, width: 455, height: 260 }, margin)).toBeNull();
  });

  it("가장자리에 여백만큼 딱 맞게 선 카드도 움직이지 않는다", () => {
    expect(
      revealMove(seen, { x: 16, y: 16, width: 1408, height: 868 }, margin),
    ).toBeNull();
  });

  it("오른쪽으로 넘친 만큼과 여백만 왼쪽으로 옮긴다", () => {
    const card = { x: 1168, y: 300, width: 455, height: 260 };

    expect(revealMove(seen, card, margin)).toEqual({ dx: -(1168 + 455 - 1440 + 16), dy: 0 });
  });

  it("화면 밖으로 아주 멀리 간 카드도 필요한 만큼만 옮긴다", () => {
    const card = { x: 2064, y: 300, width: 455, height: 260 };
    const move = revealMove(seen, card, margin);

    expect(move).toEqual({ dx: -(2064 + 455 - 1440 + 16), dy: 0 });
    // 옮긴 뒤에는 오른쪽 끝이 여백 안에 선다 — 더도 덜도 아니다.
    expect(card.x + (move?.dx ?? 0) + card.width).toBe(1440 - 16);
  });

  it("왼쪽·위로 넘친 카드는 오른쪽·아래로 데려온다", () => {
    const card = { x: -100, y: -50, width: 455, height: 260 };

    expect(revealMove(seen, card, margin)).toEqual({ dx: 116, dy: 66 });
  });

  it("아래로 넘친 카드는 세로로만 움직인다", () => {
    const card = { x: 200, y: 800, width: 455, height: 260 };

    expect(revealMove(seen, card, margin)).toEqual({ dx: 0, dy: -(800 + 260 - 900 + 16) });
  });

  it("화면보다 큰 카드는 왼쪽 위 모서리를 먼저 보여준다 — 두 방향을 동시에 만족시킬 수 없다", () => {
    const card = { x: -300, y: -300, width: 2000, height: 1200 };

    expect(revealMove(seen, card, margin)).toEqual({ dx: 316, dy: 316 });
  });
});
