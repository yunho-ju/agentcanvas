// 캔버스 위에 뜬 층이 가린 만큼을 뺀 네모 (순수 함수, DESIGN §7 palette — 보이는 네모는 덮개를 뺀 것이다).
// 면 rect 전체는 사람 눈에는 캔버스가 아니다 — 독·인스펙터·실행 독이 차지한 띠를 뺀 것만 뷰포트다.

/** 네모를 표현하는 데 필요한 것만 — DOMRect과도, ScreenBox와도 구조가 맞는다. */
export interface DOMRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 캔버스 위에 뜬 한 층이 한 변에서 얼마나 들어왔는가. */
export interface Cover {
  side: "left" | "right" | "top" | "bottom";
  size: number;
}

/** 같은 변에 덮개가 여럿이면 겹치므로 가장 큰 것만 뺀다. */
function maxSizeOf(side: Cover["side"], covers: Cover[]): number {
  return covers
    .filter((cover) => cover.side === side)
    .reduce((max, cover) => Math.max(max, cover.size), 0);
}

/** 면 rect에서 덮개들을 뺀 네모. 줄인 결과가 음수 폭·높이가 되면 0으로 자른다. */
export function visibleRect(surface: DOMRectLike, covers: Cover[]): DOMRectLike {
  const left = maxSizeOf("left", covers);
  const right = maxSizeOf("right", covers);
  const top = maxSizeOf("top", covers);
  const bottom = maxSizeOf("bottom", covers);

  return {
    x: surface.x + left,
    y: surface.y + top,
    width: Math.max(0, surface.width - left - right),
    height: Math.max(0, surface.height - top - bottom),
  };
}
