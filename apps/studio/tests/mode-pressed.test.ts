// 눌린 모드는 언제나 하나다 (DESIGN §7 mode-segment) — 무엇이 눌렸는지는 이 순수 함수가 답한다.
import { describe, expect, it } from "vitest";
import { pressedMode } from "../src/shell/modePressed";

const quiet = {
  running: false,
  evalOpen: false,
  optimizeOpen: false,
  chatOpen: false,
};

describe("지금 눌려 있는 모드", () => {
  it("아무 일도 없으면 만들고 있는 중이다", () => {
    expect(pressedMode(quiet)).toBe("build");
  });

  it("실행을 보고 있으면 실행이 눌려 있다", () => {
    expect(pressedMode({ ...quiet, running: true })).toBe("run");
  });

  it.each([
    ["evalOpen", "eval"],
    ["optimizeOpen", "optimize"],
    ["chatOpen", "chat"],
  ] as const)("%s 패널이 열려 있으면 그 모드가 눌려 있다", (open, mode) => {
    expect(pressedMode({ ...quiet, [open]: true })).toBe(mode);
  });

  // F15: 실행을 보는 중에 시험 패널을 열면 화면에 보이는 것은 시험이다.
  it("실행 중에 모드 패널을 열면 눌린 것은 그 패널이다", () => {
    expect(pressedMode({ ...quiet, running: true, evalOpen: true })).toBe("eval");
    expect(pressedMode({ ...quiet, running: true, chatOpen: true })).toBe("chat");
  });
});
