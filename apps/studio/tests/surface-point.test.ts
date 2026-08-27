// 안내와 피커가 "손이 있는 자리"에 서려면 좌표가 한 좌표계여야 한다.
// 브라우저 화면의 한 점 → 캔버스 표면 안의 자리로 옮기는 **산수만** 여기서 고정한다.
//
// 여기서 덮지 못하는 것(정직하게 적어 둔다):
// ① 라이브러리의 `flowToScreenPosition`이 정말 브라우저 화면 좌표를 돌려주는가
// ② `surface.current`가 실제로 화면 어디에 있는가 (레이아웃)
// 둘 다 jsdom에는 없는 사실이라 브라우저 실증이 확인한다 — 시험이 대신 확인한 척하지 않는다.
// ②의 전제 하나(표면 자신이 자리의 기준이 된다)만은 CSS로 고정돼 있다:
// tests/connection-hint.test.tsx "자리의 기준은 우리가 재는 그 표면이다".
import { describe, expect, it } from "vitest";
import { surfacePoint } from "../src/canvas/surfacePoint";

const surface = { left: 40, top: 60 };

describe("표면 안의 자리로 옮기기", () => {
  it("표면의 왼쪽 위를 0,0으로 삼는다", () => {
    expect(surfacePoint({ x: 140, y: 260 }, surface)).toEqual({ x: 100, y: 200 });
  });

  it("표면의 왼쪽 위 모서리는 원점이다", () => {
    expect(surfacePoint({ x: 40, y: 60 }, surface)).toEqual({ x: 0, y: 0 });
  });

  it("아직 표면을 재지 못했으면 자리를 지어내지 않는다", () => {
    expect(surfacePoint({ x: 140, y: 260 }, undefined)).toEqual({ x: 140, y: 260 });
  });

  it("표면이 움직이면 같은 화면 점이 다른 자리가 된다", () => {
    expect(surfacePoint({ x: 140, y: 260 }, { left: 0, top: 0 })).toEqual({
      x: 140,
      y: 260,
    });
    expect(surfacePoint({ x: 140, y: 260 }, surface)).toEqual({ x: 100, y: 200 });
  });
});
