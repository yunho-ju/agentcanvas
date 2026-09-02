// 새 카드를 어디에 놓는가 (순수 함수, DESIGN §7 palette 배치).
// 고른 카드가 있으면 그 옆에, 없으면 보고 있는 화면 한가운데에 — 어느 쪽이든 이미 놓인
// 카드와 겹치지 않는 첫 자리를 찾는다. 자동 연결은 하지 않는다.
import type { FlowNode } from "./serialize";

/** 캔버스 위의 한 점 — 노드가 서 있는 그 좌표계다. */
type Position = FlowNode["position"];

/** 카드 한 장의 크기 — tokens.css `--node-width` / `--node-height`의 복사본이다. */
export const NODE_SIZE = { width: 208, height: 48 };
/** 고른 카드 옆에 두는 틈 — tokens.css `--space-6`. */
export const GAP_BESIDE = 32;
/** 다음 빈 자리를 찾아 옮길 때의 틈 — tokens.css `--space-4`. */
export const GAP_NEXT = 16;

/** 자리를 정하는 데 필요한 것은 어디에 얼마만 한 카드가 있는가뿐이다. */
export interface PlacedCard {
  id: string;
  position: Position;
  /** 캔버스가 실제로 잰 크기 — 아직 재지 못했으면 없다. */
  measured?: { width?: number | null; height?: number | null } | null;
}

function sizeOf(card: PlacedCard): { width: number; height: number } {
  return {
    width: card.measured?.width ?? NODE_SIZE.width,
    height: card.measured?.height ?? NODE_SIZE.height,
  };
}

/** 이 자리에 카드를 놓으면 저 카드를 가리는가 — 맞닿는 것은 가리는 것이 아니다. */
function hides(at: Position, card: PlacedCard): boolean {
  const size = sizeOf(card);
  return (
    at.x < card.position.x + size.width &&
    card.position.x < at.x + NODE_SIZE.width &&
    at.y < card.position.y + size.height &&
    card.position.y < at.y + NODE_SIZE.height
  );
}

/** 한 방향으로 한 칸씩 비켜 가며 찾은 첫 빈 자리 — 칸이 있는 한 반드시 끝난다. */
function firstFreePlace(start: Position, step: Position, cards: PlacedCard[]): Position {
  let at = start;
  while (cards.some((card) => hides(at, card))) {
    at = { x: at.x + step.x, y: at.y + step.y };
  }
  return at;
}

/** 새 카드가 놓일 자리. */
export function placeNewNode(canvas: {
  nodes: PlacedCard[];
  selectedId?: string | null;
  viewportCenter: Position;
}): Position {
  const chosen = canvas.nodes.find((card) => card.id === canvas.selectedId);
  if (!chosen) {
    const step = { x: NODE_SIZE.width + GAP_NEXT, y: 0 };
    return firstFreePlace(canvas.viewportCenter, step, canvas.nodes);
  }
  const beside = {
    x: chosen.position.x + sizeOf(chosen).width + GAP_BESIDE,
    y: chosen.position.y,
  };
  return firstFreePlace(beside, { x: 0, y: NODE_SIZE.height + GAP_NEXT }, canvas.nodes);
}
