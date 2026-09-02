// 새로 놓은 카드를 보이게 하는 최소 이동 (순수 함수, DESIGN §7 palette 배치 — pan-to-reveal).
// 사용자가 스스로 옮긴 화면을 추가 한 번으로 뒤흔들지 않는다: 넘친 만큼과 여백만 움직이고,
// 줌은 건드리지 않는다. 이미 보이는 카드에는 아무 말도 하지 않는다.

/** 화면 위의 네모 — 보이는 영역도, 카드도 같은 좌표계의 네모다. */
export interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 한 축에서 네모를 안으로 데려오는 거리 — 이미 안이면 0. 안에 다 담기지 않으면 앞쪽을 먼저 보여준다. */
function shift(near: number, far: number, seenNear: number, seenFar: number): number {
  if (near < seenNear) return seenNear - near;
  if (far > seenFar) return Math.max(seenFar - far, seenNear - near);
  return 0;
}

/** 카드가 보이는 영역 안에 온전히 서게 하는 이동. 이미 보이면 null. */
export function revealMove(
  seen: ScreenBox,
  card: ScreenBox,
  margin: number,
): { dx: number; dy: number } | null {
  const dx = shift(card.x, card.x + card.width, seen.x + margin, seen.x + seen.width - margin);
  const dy = shift(card.y, card.y + card.height, seen.y + margin, seen.y + seen.height - margin);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}
