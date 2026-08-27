// 네 걸음의 기억 — 숨기거나 다 걸었으면 이 브라우저가 그것을 기억한다 (DESIGN §7 first-steps-card).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readFirstStepsDismissed,
  rememberFirstStepsDismissed,
} from "../src/guide/firstStepsStore";
import { useEditor } from "../src/store/editor";

beforeEach(() => {
  localStorage.clear();
  useEditor.setState({ firstStepsDismissed: false, firstStepsCelebrating: false });
});

describe("이 브라우저에 남는 기억", () => {
  it("아직 아무 말도 하지 않았으면 기억이 없다", () => {
    expect(readFirstStepsDismissed()).toBe(false);
  });

  it("한 번 접어 두면 그 뒤로는 기억한다", () => {
    rememberFirstStepsDismissed();

    expect(readFirstStepsDismissed()).toBe(true);
  });

  it("저장소를 막아 둔 브라우저에서도 화면은 뜬다", () => {
    const blocked = vi.spyOn(globalThis.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readFirstStepsDismissed()).toBe(false);

    blocked.mockRestore();
  });
});

describe("숨기기와 완주는 같은 기억을 남긴다", () => {
  it("접으면 카드는 물러나고 브라우저가 그것을 기억한다", () => {
    useEditor.getState().dismissFirstSteps();

    expect(useEditor.getState().firstStepsDismissed).toBe(true);
    expect(readFirstStepsDismissed()).toBe(true);
  });

  it("축하하는 동안에도 접으면 축하가 함께 끝난다", () => {
    useEditor.getState().celebrateFirstSteps();
    expect(useEditor.getState().firstStepsCelebrating).toBe(true);

    useEditor.getState().dismissFirstSteps();

    expect(useEditor.getState().firstStepsCelebrating).toBe(false);
  });

  it("전에 접어 둔 브라우저에서는 카드가 처음부터 물러나 있다", async () => {
    localStorage.setItem("agentcanvas.firstSteps", "done");
    vi.resetModules();

    const booted = await import("../src/store/editor");

    expect(booted.useEditor.getState().firstStepsDismissed).toBe(true);
  });
});
