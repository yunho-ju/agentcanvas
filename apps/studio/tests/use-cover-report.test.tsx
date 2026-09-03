// 캔버스 위에 뜬 한 층이 자기가 가린 띠를 store에 알린다 (DESIGN §7 palette — 보이는 네모는 덮개를 뺀 것이다).
// 컨테이너 자신이 아니라 실제로 그려진 자식들의 rect 합집합을 잰다 — 빈 스택도 padding으로 폭·높이를 가질 수 있다.
import { render, act } from "@testing-library/react";
import { useRef } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoverReport } from "../src/canvas/useCoverReport";
import { useEditor } from "../src/store/editor";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function store() {
  return useEditor.getState();
}

function asRect(box: Box): DOMRect {
  return {
    ...box,
    left: box.x,
    top: box.y,
    right: box.x + box.width,
    bottom: box.y + box.height,
    toJSON: () => ({}),
  };
}

/** 요소별 자리 — data-rect-key로 찾는다. 없으면 0×0(안 그려진 것). */
const rects = new Map<string, Box>();
const ZERO: Box = { x: 0, y: 0, width: 0, height: 0 };

const measured = vi
  .spyOn(HTMLElement.prototype, "getBoundingClientRect")
  .mockImplementation(function measure(this: HTMLElement) {
    const key = this.dataset.rectKey;
    return asRect((key ? rects.get(key) : undefined) ?? ZERO);
  });

/** jsdom의 ResizeObserver 스텁이 모아 둔 콜백들 — 크기가 바뀌는 세계를 흉내 낸다. */
function triggerResize() {
  const observers = (globalThis as unknown as { __resizeObservers?: Set<() => void> })
    .__resizeObservers;
  act(() => {
    observers?.forEach((callback) => callback());
  });
}

function Panel({ childKeys }: { childKeys: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useCoverReport(ref, "panel", "left");
  return (
    <div data-rect-key="container" ref={ref}>
      {childKeys.map((key) => (
        <div key={key} data-rect-key={key} />
      ))}
    </div>
  );
}

afterAll(() => measured.mockRestore());

afterEach(() => rects.clear());

beforeEach(() => {
  store().noteCover("panel", null);
});

describe("useCoverReport", () => {
  it("마운트하면 자식들 rect의 합집합 오른쪽 끝을 왼쪽 덮개 크기로 알린다", () => {
    rects.set("a", { x: 16, y: 200, width: 200, height: 100 });
    rects.set("b", { x: 16, y: 300, width: 317, height: 60 });

    render(<Panel childKeys={["a", "b"]} />);

    // 합집합 오른쪽 끝은 더 넓은 b의 오른쪽 끝(16+317=333).
    expect(store().covers.panel).toEqual({ side: "left", size: 333 });
  });

  // reviewer minor: 컨테이너 자체는 padding 때문에 폭·높이를 가질 수 있다(예: 빈 오른쪽 스택,
  // 실측 12×700) — 그 크기가 아니라 그려진 자식이 있는지로 판정한다.
  it("컨테이너에 크기가 있어도 그려진 자식이 하나도 없으면 덮개를 알리지 않는다", () => {
    rects.set("container", { x: 0, y: 0, width: 12, height: 700 });

    render(<Panel childKeys={[]} />);

    expect(store().covers.panel).toBeUndefined();
  });

  it("자식 rect가 커진 뒤 ResizeObserver 콜백이 오면 덮개 크기를 다시 잰다", () => {
    rects.set("a", { x: 16, y: 200, width: 200, height: 100 });
    render(<Panel childKeys={["a"]} />);
    expect(store().covers.panel).toEqual({ side: "left", size: 216 });

    rects.set("a", { x: 16, y: 200, width: 300, height: 100 });
    triggerResize();

    expect(store().covers.panel).toEqual({ side: "left", size: 316 });
  });

  it("자식이 전부 사라진 뒤 ResizeObserver 콜백이 오면 덮개가 사라진다", () => {
    rects.set("a", { x: 16, y: 200, width: 200, height: 100 });
    render(<Panel childKeys={["a"]} />);
    expect(store().covers.panel).not.toBeUndefined();

    rects.delete("a");
    triggerResize();

    expect(store().covers.panel).toBeUndefined();
  });

  // DESIGN §7 palette: 층이 닫히면 띠도 사라진다.
  it("층이 언마운트되면 덮개도 사라진다", () => {
    rects.set("a", { x: 16, y: 200, width: 200, height: 100 });
    const { unmount } = render(<Panel childKeys={["a"]} />);
    expect(store().covers.panel).not.toBeUndefined();

    unmount();

    expect(store().covers.panel).toBeUndefined();
  });
});
