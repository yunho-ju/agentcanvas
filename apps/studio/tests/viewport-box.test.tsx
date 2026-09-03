// 새 카드는 "지금 보고 있는 화면 한가운데"에서 자리를 찾는다 (DESIGN §7 palette 배치).
// 그 한가운데가 캔버스 좌표로 어디인지는 캔버스만 안다 — 캔버스가 store에 알린다.
// 화면을 끌거나 확대할 때마다 다시 알리는 것은 브라우저 QA가 본다(jsdom은 변환을 갖지 않는다).
import { render } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Canvas } from "../src/canvas/Canvas";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

// 화면의 점을 캔버스 좌표로 옮기는 일은 라이브러리의 것이다 — 여기서는 옮겨졌는지만 본다.
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      screenToFlowPosition: (at: { x: number; y: number }) => ({
        x: at.x + 1000,
        y: at.y + 500,
      }),
    }),
  };
});

const SEEN = { width: 1440, height: 900 };

// jsdom은 아무것도 재지 못한다 — 캔버스가 차지한 자리를 여기서 정해 준다.
const measured = vi
  .spyOn(HTMLElement.prototype, "getBoundingClientRect")
  .mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: SEEN.width,
    bottom: SEEN.height,
    width: SEEN.width,
    height: SEEN.height,
    toJSON: () => ({}),
  });

afterAll(() => measured.mockRestore());

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("보고 있는 화면의 한가운데", () => {
  it("캔버스가 서면 그 한가운데를 캔버스 좌표로 알린다 — 모서리가 아니다", () => {
    render(<Canvas />);

    expect(useEditor.getState().viewportCenter).toEqual({
      x: 1000 + SEEN.width / 2,
      y: 500 + SEEN.height / 2,
    });
  });

  // 화면을 끌면 매 프레임 같은 말을 다시 듣는다 — 달라진 것이 없으면 상태도 그대로다.
  it("같은 자리를 다시 알려도 상태를 새로 만들지 않는다", () => {
    useEditor.getState().noteViewportCenter({ x: 5, y: 7 });
    const first = useEditor.getState().viewportCenter;

    useEditor.getState().noteViewportCenter({ x: 5, y: 7 });

    expect(useEditor.getState().viewportCenter).toBe(first);
  });
});
