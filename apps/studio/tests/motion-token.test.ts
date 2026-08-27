// 화면이 아니라 코드가 움직이는 모션(캔버스 이동)도 시간은 토큰에서 가져온다.
// 모션을 원치 않는 사용자에게는 토큰 자체가 짧아지므로, 여기서 따로 재지 않는다.
import { afterEach, describe, expect, it } from "vitest";
import { motionDurationMs, tokenLengthPx } from "../src/canvas/motion";

afterEach(() => {
  document.documentElement.style.removeProperty("--dur-enter");
  document.documentElement.style.removeProperty("--space-2");
});

describe("모션 시간 토큰 읽기", () => {
  it("토큰에 적힌 시간을 밀리초로 읽는다", () => {
    document.documentElement.style.setProperty("--dur-enter", "240ms");

    expect(motionDurationMs("--dur-enter")).toBe(240);
  });

  it("초로 적힌 시간도 밀리초로 바꿔 읽는다", () => {
    document.documentElement.style.setProperty("--dur-enter", "0.24s");

    expect(motionDurationMs("--dur-enter")).toBe(240);
  });

  it("읽을 수 없으면 움직이지 않는다 — 값을 지어내지 않는다", () => {
    expect(motionDurationMs("--dur-enter")).toBe(0);
  });
});

// 자리를 잡는 코드(안내가 설 자리 등)도 간격을 토큰에서 가져온다.
describe("길이 토큰 읽기", () => {
  it("토큰에 적힌 길이를 픽셀로 읽는다", () => {
    document.documentElement.style.setProperty("--space-2", "8px");

    expect(tokenLengthPx("--space-2")).toBe(8);
  });

  it("읽을 수 없으면 0이다 — 값을 지어내지 않는다", () => {
    expect(tokenLengthPx("--space-2")).toBe(0);
  });
});
