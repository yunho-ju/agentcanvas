// 상단 레이어가 폭에 따라 접히는 순서 (DESIGN §1 상단 레이어).
// 겹치는지는 실제 브라우저의 눈이 보는 일이고, 여기서는 무엇이 남고 무엇이 접히는지를 고정한다.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { viewportWidth } from "./viewportWidth";

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  useEditor.getState().loadSpec(example);
});

afterEach(() => vi.unstubAllGlobals());

const NOTICE = "이 화면은 데스크톱에서 편집할 수 있어요 — 여기서는 보기만 돼요";

describe("휴대폰 폭에서는 보기만 된다고 먼저 말한다", () => {
  it("600px 아래에서는 한 줄로 말해 준다 — 조용히 못 쓰게 두지 않는다", () => {
    viewportWidth(390);

    render(<App />);

    expect(screen.getByText(NOTICE)).toHaveAttribute("role", "status");
  });

  it("그 폭에서도 문서 메뉴에는 손이 닿는다", () => {
    viewportWidth(390);

    render(<App />);

    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toBeInTheDocument();
  });

  it("데스크톱 폭에서는 그 안내가 없다", () => {
    viewportWidth(1024);

    render(<App />);

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
