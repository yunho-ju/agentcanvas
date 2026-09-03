// 캔버스 위에 뜬 한 층이 자기가 가린 띠를 store에 알린다 (DESIGN §7 palette — 보이는 네모는 덮개를 뺀 것이다).
// 층 컨테이너 자신의 rect가 아니라 실제로 그려진 자식들의 rect 합집합을 잰다 — 안이 비어도
// 컨테이너 자체는 padding 때문에 폭·높이를 가질 수 있다(예: 빈 오른쪽 스택).
// 면(.app__canvas)은 inset:0으로 창을 그대로 채우므로, 창 자체를 면 rect로 쓴다 — 재는 것은 창뿐이다.
import { type RefObject, useEffect } from "react";
import type { Cover } from "../graph/visibleRect";
import { useEditor } from "../store/editor";

interface EdgeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 요소 rect에서 그 변으로 얼마나 들어왔는지 — 창을 면으로 본 값이다. */
function sizeFrom(side: Cover["side"], rect: EdgeRect): number {
  switch (side) {
    case "left":
      return rect.right;
    case "right":
      return window.innerWidth - rect.left;
    case "top":
      return rect.bottom;
    case "bottom":
      return window.innerHeight - rect.top;
  }
}

/** 실제로 그려진(폭·높이 모두 있는) 자식들의 rect 합집합 — 하나도 없으면 없다. */
function childUnion(element: HTMLElement): EdgeRect | null {
  const drawn = Array.from(element.children)
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (drawn.length === 0) return null;
  return {
    left: Math.min(...drawn.map((rect) => rect.left)),
    right: Math.max(...drawn.map((rect) => rect.right)),
    top: Math.min(...drawn.map((rect) => rect.top)),
    bottom: Math.max(...drawn.map((rect) => rect.bottom)),
  };
}

export function useCoverReport(
  ref: RefObject<HTMLElement | null>,
  id: string,
  side: Cover["side"],
): void {
  const noteCover = useEditor((state) => state.noteCover);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      noteCover(id, null);
      return;
    }

    function report() {
      const el = ref.current;
      const union = el ? childUnion(el) : null;
      noteCover(id, union ? { side, size: sizeFrom(side, union) } : null);
    }

    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      // 층이 닫히거나 사라지면 띠도 사라진다 (DESIGN §7 palette — 층이 닫히면 띠도 사라진다).
      noteCover(id, null);
    };
  }, [ref, id, side, noteCover]);
}
