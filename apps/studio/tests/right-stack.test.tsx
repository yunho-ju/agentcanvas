// 우측 기둥이 자리를 나누는 규칙 (DESIGN §1 "우측 레이어의 자리 나눔").
// jsdom은 높이를 재지 못한다 — 여기서는 규칙이 한 자리에 있다는 것(모드 패널이 스스로를 밝히고,
// 스택이 스스로 스크롤한다)까지 고정하고, 실제로 겹치지 않는지는 브라우저 QA가 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { ChatPanel } from "../src/chat/ChatPanel";
import { EvalPanel } from "../src/eval/EvalPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SpecPublication } from "../src/generated/spec_publication";
import { OptimizePanel } from "../src/optimize/OptimizePanel";
import { useEditor } from "../src/store/editor";
import { modePanelOpen } from "../src/store/modePanels";

const example = exampleSpec as unknown as AgentSpec;

const publication: SpecPublication = {
  spec_id: example.id,
  revision: example.revision,
  published_at: "2026-08-01T12:00:00Z",
};

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  act(() => store().abandonChat());
  useEditor.setState({
    spec: example,
    evalPanelOpen: false,
    chatOpen: false,
    optimizeMode: "closed",
  });
});

// 세 패널은 같은 자리를 나눠 쓴다 — 자리 규칙이 세 이름을 따로 외우게 하지 않는다.
describe("모드 패널은 스스로를 모드 패널이라 밝힌다", () => {
  it("시험 패널", () => {
    useEditor.setState({ evalPanelOpen: true });

    const { container } = render(<EvalPanel />);

    expect(container.querySelector(".eval-panel")).toHaveAttribute("data-mode-panel", "eval");
  });

  it("고치기 패널", () => {
    useEditor.setState({ optimizeMode: "input" });

    const { container } = render(<OptimizePanel />);

    expect(container.querySelector(".optimize-panel")).toHaveAttribute(
      "data-mode-panel",
      "optimize",
    );
  });

  it("대화 패널", () => {
    useEditor.setState({
      chatOpen: true,
      publication,
      publishedVersion: 7,
      publishedSpec: example,
    });

    const { container } = render(<ChatPanel />);

    expect(container.querySelector(".chat-panel")).toHaveAttribute("data-mode-panel", "chat");
  });
});

describe("지금 우측 자리에 모드 패널이 서 있는가", () => {
  it("아무 패널도 없으면 서 있지 않다", () => {
    expect(modePanelOpen(store())).toBe(false);
  });

  it("셋 가운데 무엇이 서도 같은 답이다", () => {
    for (const opened of [
      { evalPanelOpen: true },
      { chatOpen: true },
      { optimizeMode: "input" as const },
    ]) {
      useEditor.setState({ evalPanelOpen: false, chatOpen: false, optimizeMode: "closed" });
      useEditor.setState(opened);

      expect(modePanelOpen(store())).toBe(true);
    }
  });
});

describe("기둥이 자리를 나누는 규칙은 CSS가 갖는다", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  /** 규칙 하나를 통째로 집는다 — 선택자를 어떻게 줄바꿈해 적어도 값이 그대로 읽힌다. */
  function rule(pattern: RegExp): string {
    return app.match(pattern)?.[0] ?? "";
  }

  it("스크롤은 손이 닿는 안쪽 기둥의 일이다 — 클릭을 받지 않는 겉 레이어가 스크롤바를 들지 않는다", () => {
    const outer = rule(/\.layer-right \{[^}]*\}/);
    const stack = rule(/\.layer-right__stack \{[^}]*\}/);

    expect(outer).toContain("pointer-events: none");
    expect(outer).not.toContain("overflow");
    expect(stack).toContain("overflow-y: auto");
    expect(stack).toContain("pointer-events: auto");
  });

  // 스크롤 상자는 넘치는 것을 자른다 — 카드의 그림자와 초점 링은 그 여백 안에 들어와야 한다.
  it("카드의 그림자와 초점 링이 잘리지 않게 여백을 둔다", () => {
    const stack = rule(/\.layer-right__stack \{[^}]*\}/);

    expect(stack).toMatch(/padding:[^;]*var\(--space-\d\)/);
    expect(stack).toMatch(/margin-right:[^;]*var\(--space-\d\)/);
  });

  it("모드 패널은 안내 옆에서도 읽을 만큼은 선다", () => {
    const panels = rule(/\.layer-right__stack > \[data-mode-panel\][^{]*\{[^}]*\}/);

    expect(panels).toContain("min-height: calc(var(--space-6) * 8)");
  });
});
