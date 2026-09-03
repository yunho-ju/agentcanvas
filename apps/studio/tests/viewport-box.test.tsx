// 새 카드는 "지금 보고 있는 화면" 안에서 자리를 찾는다 (DESIGN §7 palette 배치).
// 그 화면이 캔버스 좌표로 어디인지는 캔버스만 안다 — 캔버스가 store에 알린다.
// 화면을 끌거나 확대할 때마다 다시 알리는 것은 브라우저 QA가 본다(jsdom은 변환을 갖지 않는다).
import { render } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Canvas } from "../src/canvas/Canvas";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

// 화면의 점을 캔버스 좌표로 옮기는 일은 라이브러리의 것이다 — 여기서는 옮겨졌는지만 본다.
// 확대 2배(화면 2px = 캔버스 1px)로 옮긴다 — 평행이동만이면 '폭을 화면 픽셀로 적는' 잘못을 못 잡는다.
const ZOOM = 2;
const screenToFlowPosition = (at: { x: number; y: number }) => ({
  x: at.x / ZOOM + 1000,
  y: at.y / ZOOM + 500,
});

/** 캔버스가 차지한 자리 — 창 크기가 바뀌면 여기가 바뀐다. */
const SEEN = { width: 1440, height: 900 };
const seen = { ...SEEN };

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), screenToFlowPosition }),
    // 라이브러리가 잰 캔버스 크기 — 창 크기가 바뀌면 이 값이 바뀐다.
    useStore: <T,>(select: (state: Record<string, unknown>) => T, equal?: (a: T, b: T) => boolean) =>
      actual.useStore(
        (state) => select({ ...(state as Record<string, unknown>), width: seen.width, height: seen.height }),
        equal,
      ),
  };
});

// jsdom은 아무것도 재지 못한다 — 캔버스가 차지한 자리를 여기서 정해 준다.
const measured = vi
  .spyOn(HTMLElement.prototype, "getBoundingClientRect")
  .mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: seen.width,
    bottom: seen.height,
    width: seen.width,
    height: seen.height,
    toJSON: () => ({}),
  }));

afterAll(() => measured.mockRestore());

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  Object.assign(seen, SEEN);
  useEditor.getState().loadSpec(example);
});

describe("보고 있는 화면", () => {
  it("캔버스가 서면 자기가 보여주는 네모를 캔버스 좌표로 알린다 — 한 점이 아니다, 화면 픽셀도 아니다", () => {
    render(<Canvas />);

    expect(useEditor.getState().viewportBox).toEqual({
      x: 1000,
      y: 500,
      width: SEEN.width / ZOOM,
      height: SEEN.height / ZOOM,
    });
  });

  // 창을 줄이면 보이는 네모도 줄어든다 — 팬·줌이 없어도 다시 잰다 (DESIGN §7 palette 화면 안이 먼저다).
  it("창 크기가 바뀌면 다시 잰다", () => {
    const { rerender } = render(<Canvas />);
    const narrower = { width: 720, height: 450 };

    Object.assign(seen, narrower);
    rerender(<Canvas />);

    expect(useEditor.getState().viewportBox).toEqual({
      x: 1000,
      y: 500,
      width: narrower.width / ZOOM,
      height: narrower.height / ZOOM,
    });
  });

  // 화면을 끌면 매 프레임 같은 말을 다시 듣는다 — 달라진 것이 없으면 상태도 그대로다.
  it("같은 자리를 다시 알려도 상태를 새로 만들지 않는다", () => {
    const seen = { x: 5, y: 7, width: 100, height: 80 };
    useEditor.getState().noteViewportBox(seen);
    const first = useEditor.getState().viewportBox;

    useEditor.getState().noteViewportBox({ ...seen });

    expect(useEditor.getState().viewportBox).toBe(first);
  });
});
