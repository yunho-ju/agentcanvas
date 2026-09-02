// 새로 놓은 카드가 화면 밖이면 캔버스가 데리러 간다 (DESIGN §7 palette 배치 — pan-to-reveal).
// 카드가 화면 어디에 얼마만 하게 서 있는지는 그 카드의 DOM만 안다 — 줌·측정·transform을
// 코드가 다시 계산하지 않는다(브라우저 QA에서 이동량이 모자랐던 자리).
import { act, render } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Canvas } from "../src/canvas/Canvas";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const setViewport = vi.fn();
const fitView = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      fitView,
      setViewport,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    }),
  };
});

const SEEN = { x: 0, y: 0, width: 1440, height: 900 };
const MARGIN = 16;
const NOT_MEASURED = { x: 0, y: 0, width: 0, height: 0 };
// 실브라우저(1440×900, 줌 ≈2)에서 두 번째 카드가 섰던 자리 — 오른쪽으로 넘친다.
const OUTSIDE = { x: 1146, y: 300, width: 453, height: 260 };
const INSIDE = { x: 200, y: 300, width: 453, height: 260 };

let cardBox = NOT_MEASURED;

function asRect(box: { x: number; y: number; width: number; height: number }): DOMRect {
  return {
    ...box,
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => ({}),
  };
}

// jsdom은 아무것도 재지 못한다 — 캔버스와 카드의 자리를 여기서 정해 준다.
const measured = vi
  .spyOn(HTMLElement.prototype, "getBoundingClientRect")
  .mockImplementation(function measure(this: HTMLElement) {
    if (this.classList.contains("react-flow__node")) return asRect(cardBox);
    if (this.classList.contains("canvas")) return asRect(SEEN);
    return asRect(NOT_MEASURED);
  });

afterAll(() => {
  measured.mockRestore();
  document.documentElement.style.removeProperty("--space-4");
});

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 캔버스가 카드를 재고 다시 그릴 틈 — 한 프레임. */
async function nextFrame() {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(() => done(null)));
  });
}

beforeEach(() => {
  // 여백은 토큰의 것이다 — jsdom에는 스타일시트가 없으므로 여기서 그 값을 꽂아 둔다.
  document.documentElement.style.setProperty("--space-4", `${MARGIN}px`);
  cardBox = OUTSIDE;
  store().loadSpec(example);
  setViewport.mockClear();
  fitView.mockClear();
});

describe("화면 밖에 놓인 카드", () => {
  it("카드가 실제로 서 있는 자리를 기준으로 넘친 만큼만 화면을 옮긴다", () => {
    render(<Canvas />);
    setViewport.mockClear();

    act(() => {
      store().revealNode("input");
    });

    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(setViewport.mock.calls[0][0]).toEqual({
      x: SEEN.width - MARGIN - (OUTSIDE.x + OUTSIDE.width),
      y: 0,
      zoom: 1,
    });
  });

  it("줌은 건드리지 않는다 — 전체 보기와 다른 부탁이다", () => {
    render(<Canvas />);

    act(() => {
      store().revealNode("input");
    });

    expect(fitView).not.toHaveBeenCalled();
  });

  it("한 부탁은 한 번만 화면을 옮긴다 — 들어준 부탁은 남지 않는다", async () => {
    render(<Canvas />);
    setViewport.mockClear();

    act(() => {
      store().revealNode("input");
    });
    await nextFrame();

    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(store().viewRequest).toBeNull();
  });

  it("이미 보이는 카드에는 화면이 꿈쩍도 하지 않는다", () => {
    cardBox = INSIDE;
    render(<Canvas />);
    setViewport.mockClear();

    act(() => {
      store().revealNode("input");
    });

    expect(setViewport).not.toHaveBeenCalled();
    expect(store().viewRequest).toBeNull();
  });
});

describe("아직 재지 못한 카드", () => {
  it("잰 자리가 없으면 옮기지 않고 부탁을 그대로 둔다 — 모르는 채로 화면을 흔들지 않는다", () => {
    cardBox = NOT_MEASURED;
    render(<Canvas />);
    setViewport.mockClear();

    act(() => {
      store().revealNode("input");
    });

    expect(setViewport).not.toHaveBeenCalled();
    expect(store().viewRequest).not.toBeNull();
  });

  it("캔버스가 카드를 재고 나면 그때 옮긴다 — 한 번만", async () => {
    cardBox = NOT_MEASURED;
    render(<Canvas />);
    setViewport.mockClear();
    act(() => {
      store().revealNode("input");
    });

    cardBox = OUTSIDE;
    await nextFrame();

    expect(setViewport).toHaveBeenCalledTimes(1);
    expect(store().viewRequest).toBeNull();
  });

  it("캔버스에 없는 카드를 보여 달라는 부탁은 아무 카드도 대신 옮기지 않는다", async () => {
    cardBox = OUTSIDE;
    render(<Canvas />);
    setViewport.mockClear();
    act(() => {
      store().revealNode("nowhere");
    });

    for (let frame = 0; frame < 12; frame++) await nextFrame();

    expect(setViewport).not.toHaveBeenCalled();
    expect(store().viewRequest).toBeNull();
  });

  it("끝내 재지 못하면 화면을 흔들지 않고 부탁을 놓는다 — 매 프레임 다시 묻지 않는다", async () => {
    cardBox = NOT_MEASURED;
    render(<Canvas />);
    setViewport.mockClear();
    act(() => {
      store().revealNode("input");
    });

    for (let frame = 0; frame < 12; frame++) await nextFrame();

    expect(setViewport).not.toHaveBeenCalled();
    expect(store().viewRequest).toBeNull();
  });

  it("한 부탁을 포기해도 다음 부탁은 처음부터 기다린다", async () => {
    cardBox = NOT_MEASURED;
    render(<Canvas />);
    act(() => {
      store().revealNode("input");
    });
    for (let frame = 0; frame < 12; frame++) await nextFrame();
    setViewport.mockClear();

    act(() => {
      store().revealNode("input");
    });
    cardBox = OUTSIDE;
    await nextFrame();

    expect(setViewport).toHaveBeenCalledTimes(1);
  });
});

describe("새로 놓은 카드", () => {
  it("놓이자마자 보이게 해 달라고 남긴다 — 어느 입구로 놓았든", () => {
    store().loadSpec({ ...example, nodes: [], edges: [] });

    act(() => {
      store().addNode("core.input", { x: 4000, y: 0 });
    });

    expect(store().viewRequest).toEqual({
      kind: "reveal",
      nodes: [store().nodes.at(-1)?.id],
    });
  });
});
