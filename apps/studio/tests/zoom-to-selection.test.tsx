// 보고 싶은 것으로 화면을 데려가는 길 (브리프 B7) — Figma 관례를 따른 Shift+1 / Shift+2.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function focusCanvas() {
  screen.getByRole("application", { name: /캔버스/ }).focus();
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("화면을 데려가는 부탁", () => {
  it("처음에는 아무 부탁도 없다", () => {
    expect(store().viewRequest).toBeNull();
  });

  it("전체 보기는 노드를 가리지 않는다 — 캔버스에 있는 것 전부다", () => {
    store().fitAll();

    expect(store().viewRequest?.nodes).toEqual([]);
  });

  it("고른 것 보기는 그 노드만 가리킨다", () => {
    store().select("node", "triage");

    store().fitSelection();

    expect(store().viewRequest?.nodes).toEqual(["triage"]);
  });

  it("고른 것이 없으면 화면을 흔들지 않는다", () => {
    store().fitSelection();

    expect(store().viewRequest).toBeNull();
  });

  it("같은 곳을 다시 부탁해도 새 부탁으로 알아본다", () => {
    store().fitAll();
    const first = store().viewRequest;
    store().fitAll();

    expect(store().viewRequest).not.toBe(first);
  });
});

describe("단축키", () => {
  it("Shift+1은 캔버스 전체를 보여준다", async () => {
    render(<App />);
    focusCanvas();

    await userEvent.keyboard("{Shift>}1{/Shift}");

    expect(store().viewRequest?.nodes).toEqual([]);
  });

  it("Shift+2는 고른 노드로 데려간다", async () => {
    render(<App />);
    store().select("node", "triage");
    focusCanvas();

    await userEvent.keyboard("{Shift>}2{/Shift}");

    expect(store().viewRequest?.nodes).toEqual(["triage"]);
  });

  it("글자를 치는 중에는 숫자가 화면을 옮기지 않는다", async () => {
    render(<App />);
    store().select("node", "triage");
    focusCanvas();
    // 피커의 검색 칸에 손이 가 있는 동안 숫자는 그 칸의 것이다.
    act(() => {
      store().openPicker({ at: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, from: null });
    });

    await userEvent.keyboard("{Shift>}2{/Shift}");

    expect(store().viewRequest).toBeNull();
  });
});
