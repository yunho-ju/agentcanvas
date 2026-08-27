// 노드를 끄는 동안 다른 노드와 줄이 맞는 순간을 찾는다 (디자인 언어 §2.4).
// 순수한 계산만 있다 — 안내선을 언제 그릴지·어떻게 그릴지는 화면의 몫이다.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** x는 세로로 선 안내선(왼쪽·가운데·오른쪽 변), y는 가로로 누운 안내선이다. */
export interface Guide {
  axis: "x" | "y";
  at: number;
}

export interface Alignment {
  position: { x: number; y: number };
  guides: Guide[];
}

/** 이보다 가까워지면 줄을 맞춘다 — 손이 미세하게 떨려도 자리가 잡힌다. */
export const SNAP_RANGE = 6;

/** 한 상자가 한 축에서 내놓는 세 줄 — 앞 변, 가운데, 뒤 변. */
function lines(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

/** 한 축에서 가장 가까운 줄을 찾는다. 아무 줄도 닿지 않으면 없다. */
function snapOn(
  start: number,
  size: number,
  others: { start: number; size: number }[],
  range: number,
): { start: number; at: number } | undefined {
  let best: { start: number; at: number; distance: number } | undefined;
  for (const line of lines(start, size)) {
    const offset = line - start;
    for (const other of others) {
      for (const target of lines(other.start, other.size)) {
        const distance = Math.abs(target - line);
        // 같은 거리라면 먼저 본 줄이 이긴다 — 앞 변 > 가운데 > 뒤 변 순으로 자연스럽다.
        if (distance > range || (best && distance >= best.distance)) continue;
        best = { start: target - offset, at: target, distance };
      }
    }
  }
  return best && { start: best.start, at: best.at };
}

/** 끄는 노드가 다른 노드들과 줄이 맞는 자리와, 그때 세울 안내선. */
export function alignmentFor(
  moving: Box,
  others: Box[],
  range: number = SNAP_RANGE,
): Alignment {
  const horizontal = snapOn(
    moving.x,
    moving.width,
    others.map((box) => ({ start: box.x, size: box.width })),
    range,
  );
  const vertical = snapOn(
    moving.y,
    moving.height,
    others.map((box) => ({ start: box.y, size: box.height })),
    range,
  );

  return {
    position: {
      x: horizontal?.start ?? moving.x,
      y: vertical?.start ?? moving.y,
    },
    guides: [
      ...(horizontal ? [{ axis: "x" as const, at: horizontal.at }] : []),
      ...(vertical ? [{ axis: "y" as const, at: vertical.at }] : []),
    ],
  };
}
