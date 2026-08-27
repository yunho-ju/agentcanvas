// 안내가 서는 자리 (DESIGN §7 connection-hint): 손이 있던 자리 아래, 가장자리에서는 안쪽으로.
import { describe, expect, it } from "vitest";
import { hintAnchor, portPoint } from "../src/canvas/hintAnchor";

const surface = { width: 1000, height: 600 };
const hint = { width: 200, height: 40 };
const gap = 8;

describe("안내가 서는 자리", () => {
  it("손이 있던 자리 바로 아래, 그 자리를 가운데 두고 선다", () => {
    expect(hintAnchor({ x: 500, y: 300 }, surface, hint, gap)).toEqual({
      left: 400,
      top: 308,
    });
  });

  it("아래가 모자라면 위로 뒤집는다 — 화면 밖에서 말하지 않는다", () => {
    expect(hintAnchor({ x: 500, y: 580 }, surface, hint, gap).top).toBe(532);
  });

  it("왼쪽 가장자리에서는 안쪽으로 물러선다", () => {
    expect(hintAnchor({ x: 10, y: 300 }, surface, hint, gap).left).toBe(8);
  });

  it("오른쪽 가장자리에서도 안쪽으로 물러선다", () => {
    expect(hintAnchor({ x: 990, y: 300 }, surface, hint, gap).left).toBe(792);
  });

  it("아직 크기를 재지 못했어도 손이 있던 자리 아래에 선다 — 자리를 지어내지 않는다", () => {
    expect(
      hintAnchor({ x: 40, y: 60 }, { width: 0, height: 0 }, { width: 0, height: 0 }, gap),
    ).toEqual({ left: 40, top: 68 });
  });
});

// 어떤 말은 화면의 한 점이 아니라 **그 포트**를 가리킨다 — 화면이 그 점을 찾아 준다 (DESIGN §7).
describe("포트 하나가 서 있는 자리", () => {
  it("표면 안의 좌표로 옮긴 그 점의 한가운데다", () => {
    expect(
      portPoint(
        { left: 500, top: 300, width: 8, height: 8 },
        { left: 100, top: 50, width: 1000, height: 600 },
      ),
    ).toEqual({ x: 404, y: 254 });
  });

  it("표면이 화면 왼쪽 위 구석이면 그대로 그 자리다", () => {
    expect(
      portPoint(
        { left: 20, top: 40, width: 8, height: 8 },
        { left: 0, top: 0, width: 800, height: 600 },
      ),
    ).toEqual({ x: 24, y: 44 });
  });
});
