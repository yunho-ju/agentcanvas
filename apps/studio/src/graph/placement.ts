// 새 카드를 어디에 놓는가 (순수 함수, DESIGN §7 palette 배치).
// 고른 카드가 있으면 그 옆에, 없으면 보고 있는 화면 한가운데에 — 어느 쪽이든 이미 놓인
// 카드와 겹치지 않는 첫 자리를 찾는다. 자동 연결은 하지 않는다.
import type { FlowNode } from "./serialize";

/** 캔버스 위의 한 점 — 노드가 서 있는 그 좌표계다. */
type Position = FlowNode["position"];

/** 지금 보고 있는 화면 — 캔버스 좌표로 잰 네모다. 캔버스만 아는 것을 store가 전해 준다. */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 보고 있는 화면의 한가운데. */
function middleOf(view: ViewBox): Position {
  return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
}

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

/** 카드 한 장의 크기 — 토큰의 것이거나, 캔버스가 실제로 잰 것이다. */
interface CardSize {
  width: number;
  height: number;
}

/**
 * 새 카드가 그려질 크기 — 이미 놓인 카드 가운데 가장 넓고 가장 높은 것이 말해 준다
 * (DESIGN §7 palette). 카드는 토큰보다 넓게 그려질 수 있고, 아직 한 장도 없으면 토큰이 유일한 답이다.
 */
function cardSizeAmong(cards: PlacedCard[]): CardSize {
  return cards.reduce((biggest, card) => {
    const size = sizeOf(card);
    return {
      width: Math.max(biggest.width, size.width),
      height: Math.max(biggest.height, size.height),
    };
  }, NODE_SIZE);
}

/** 이 자리에 이만 한 카드를 놓으면 저 카드를 가리는가 — 맞닿는 것은 가리는 것이 아니다. */
function hides(at: Position, size: CardSize, card: PlacedCard): boolean {
  const other = sizeOf(card);
  return (
    at.x < card.position.x + other.width &&
    card.position.x < at.x + size.width &&
    at.y < card.position.y + other.height &&
    card.position.y < at.y + size.height
  );
}

/** 한 방향으로 한 칸씩 비켜 가며 찾은 첫 빈 자리 — 칸이 있는 한 반드시 끝난다. */
function firstFreePlace(
  start: Position,
  step: Position,
  size: CardSize,
  cards: PlacedCard[],
): Position {
  let at = start;
  while (cards.some((card) => hides(at, size, card))) {
    at = { x: at.x + step.x, y: at.y + step.y };
  }
  return at;
}

/** 이만 한 카드 한 장이 이 화면 안에 온전히 서는가. */
function standsInView(at: Position, size: CardSize, view: ViewBox): boolean {
  return (
    at.x >= view.x &&
    at.y >= view.y &&
    at.x + size.width <= view.x + view.width &&
    at.y + size.height <= view.y + view.height
  );
}

/** 한 축에서 한가운데를 지나는 격자점들 — 양쪽으로 뻗되 화면 안에 남는 것만, 작은 쪽부터. */
function gridLine(middle: number, step: number, least: number, most: number): number[] {
  const before: number[] = [];
  for (let at = middle - step; at >= least; at -= step) before.unshift(at);
  const after: number[] = [];
  for (let at = middle; at <= most; at += step) after.push(at);
  return [...before.filter((at) => at <= most), ...after.filter((at) => at >= least)];
}

/**
 * 같은 줄에서 살펴볼 순서 — 가운데 칸에서 오른쪽으로 차례로, 오른쪽 끝이 차면 왼쪽 칸들을 가까운 순으로.
 * 가운데에서 번갈아 퍼지면 세 번째 카드가 첫 카드 왼쪽에 서서 읽는 순서가 깨진다 (DESIGN §7 palette).
 */
function alongTheRow(columns: number[], anchorX: number): number[] {
  const rightwards = columns.filter((x) => x >= anchorX).sort((one, other) => one - other);
  const leftwards = columns.filter((x) => x < anchorX).sort((one, other) => other - one);
  return [...rightwards, ...leftwards];
}

/**
 * 줄을 살펴볼 순서 — 가운데 줄에서 아래로 차례로, 아래 줄이 다 차면 위 줄들을 가까운 순으로.
 * 아래·위를 번갈아 잡으면 세로로 감길 때 세 번째 카드가 첫 카드 위에 서서 읽는 순서가 깨진다
 * (DESIGN §7 palette — 가로에서 오른쪽을 다 쓰고 왼쪽으로 가는 것과 같은 이치).
 */
function fromTheMiddleRow(rows: number[], anchorY: number): number[] {
  const downwards = rows.filter((y) => y >= anchorY).sort((one, other) => one - other);
  const upwards = rows.filter((y) => y < anchorY).sort((one, other) => other - one);
  return [...downwards, ...upwards];
}

/**
 * 격자의 가운데 칸 — 카드 **중심**이 화면 한가운데에 오는 자리다 (DESIGN §7 palette).
 * 좌상단을 한가운데에 두면 카드가 오른쪽으로 치우쳐, 넓은 카드는 한 줄에 둘밖에 서지 못한다.
 */
function anchorIn(view: ViewBox, size: CardSize): Position {
  const middle = middleOf(view);
  return { x: middle.x - size.width / 2, y: middle.y - size.height / 2 };
}

/**
 * 화면 안에서 카드가 설 수 있는 자리들 — 가운데 칸을 지나는 카드 크기 + `--space-4` 격자.
 * 순서는 흐름 방향을 따른다 (DESIGN §7 palette): 가운데 줄을 먼저, 그 줄 안에서는 오른쪽으로 차례로.
 */
function placesInView(view: ViewBox, size: CardSize): Position[] {
  const anchor = anchorIn(view, size);
  const columns = gridLine(
    anchor.x,
    size.width + GAP_NEXT,
    view.x,
    view.x + view.width - size.width,
  );
  const rows = gridLine(
    anchor.y,
    size.height + GAP_NEXT,
    view.y,
    view.y + view.height - size.height,
  );
  const order = alongTheRow(columns, anchor.x);
  return fromTheMiddleRow(rows, anchor.y).flatMap((y) => order.map((x) => ({ x, y })));
}

/**
 * 화면 안의 빈 자리 (DESIGN §7 palette — 화면 안이 먼저다). 오른쪽만이 아니라 왼쪽·아래·위도 살핀다.
 * 카드는 세로로 쌓이지 않고 가운데 줄을 따라 왼쪽→오른쪽으로 늘어선다(정리하기의 LR과 같은 그림).
 * 화면 안에 빈 자리가 하나도 없으면 없다.
 */
function freePlaceInView(view: ViewBox, cards: PlacedCard[]): Position | null {
  const size = cardSizeAmong(cards);
  const free = placesInView(view, size).find(
    (at) => !cards.some((card) => hides(at, size, card)),
  );
  return free ?? null;
}

/** 두 세로 범위가 겹치는가 — 같은 줄에 선 카드인지 이것으로 가른다. */
function sameRow(at: Position, size: CardSize, card: PlacedCard): boolean {
  const other = sizeOf(card);
  return at.y < card.position.y + other.height && card.position.y < at.y + size.height;
}

/**
 * 그 자리에 놓으면 그 줄 전체가 화면 폭에 들어오는가 (DESIGN §7 palette — 화면 안이 먼저다).
 * 줄 = 그 줄에서 가장 왼쪽 카드의 왼쪽 끝부터 새 카드의 오른쪽 끝까지. 화면 폭에서 `--space-4` 하나를
 * 뺀 너비 안이면 — 이동 규칙이 새 카드 쪽에만 그 여백을 붙여 최소로 따라가므로 — 가장 왼쪽 카드가 그대로 보인다.
 */
function rowFitsView(at: Position, size: CardSize, cards: PlacedCard[], view: ViewBox): boolean {
  const leftmost = cards
    .filter((card) => sameRow(at, size, card))
    .reduce((least, card) => Math.min(least, card.position.x), at.x);
  return at.x + size.width - leftmost <= view.width - GAP_NEXT;
}

/** 그 자리에 놓아도 줄이 지켜지는가 — 보이거나, 그 줄이 화면 폭에 들어오거나 (DESIGN §7 palette 줄 유지 조건). */
function keepsTheRow(at: Position, size: CardSize, cards: PlacedCard[], view: ViewBox): boolean {
  return standsInView(at, size, view) || rowFitsView(at, size, cards, view);
}

/** 화면 가운데 줄에 이미 선 카드 중 가장 오른쪽 것 — 그 줄에 카드가 없으면 없다. */
function rightmostOnTheMiddleRow(cards: PlacedCard[], view: ViewBox): PlacedCard | null {
  const size = cardSizeAmong(cards);
  const anchor = anchorIn(view, size);
  return cards
    .filter((card) => sameRow(anchor, size, card))
    .reduce<PlacedCard | null>(
      (rightmost, card) =>
        rightmost && rightmost.position.x >= card.position.x ? rightmost : card,
      null,
    );
}

/**
 * 고른 카드가 없을 때의 자리 (DESIGN §7 palette 놓이는 자리) — 가운데 줄의 가장 오른쪽 카드 옆
 * (`--space-4`, 그 카드의 실측 폭 기준), 줄이 화면 폭에 들어오는 한. 그 줄에 카드가 없거나 줄이 넘치면
 * 없다 — 그때는 화면 안 빈 자리를 격자로 살핀다. 선택이 있든 없든 연달아 놓은 카드는 한 줄에 읽는 순서로 선다.
 */
function nextOnTheMiddleRow(cards: PlacedCard[], view: ViewBox): Position | null {
  const rightmost = rightmostOnTheMiddleRow(cards, view);
  if (!rightmost) return null;
  const beside = {
    x: rightmost.position.x + sizeOf(rightmost).width + GAP_NEXT,
    y: rightmost.position.y,
  };
  const size = cardSizeAmong(cards);
  if (cards.some((card) => hides(beside, size, card))) return null;
  return keepsTheRow(beside, size, cards, view) ? beside : null;
}

/** 새 카드가 놓일 자리. */
export function placeNewNode(canvas: {
  nodes: PlacedCard[];
  selectedId?: string | null;
  viewport: ViewBox;
}): Position {
  // 새 카드의 크기 추정치는 하나다 (DESIGN §7 palette 새 카드의 크기 추정) — 겹침·줄 유지·격자 전부 이 값.
  const size = cardSizeAmong(canvas.nodes);
  const chosen = canvas.nodes.find((card) => card.id === canvas.selectedId);
  if (!chosen) {
    // 고른 카드가 없으면 가운데 줄의 가장 오른쪽 카드 옆, 아니면 보고 있는 화면 안 가운데에서 가장 가까운
    // 빈 자리다 (DESIGN §7 palette 놓이는 자리). 화면이 꽉 찼을 때만 걸어 나간다.
    const step = { x: size.width + GAP_NEXT, y: 0 };
    return (
      nextOnTheMiddleRow(canvas.nodes, canvas.viewport) ??
      freePlaceInView(canvas.viewport, canvas.nodes) ??
      firstFreePlace(anchorIn(canvas.viewport, size), step, size, canvas.nodes)
    );
  }
  const beside = {
    x: chosen.position.x + sizeOf(chosen).width + GAP_BESIDE,
    y: chosen.position.y,
  };
  const asked = firstFreePlace(beside, { x: 0, y: size.height + GAP_NEXT }, size, canvas.nodes);
  // 화면 안이 먼저다 (DESIGN §7 palette) — 옆자리가 보이거나, 그 줄이 화면 폭에 들어오면 그대로
  // 오른쪽이다(읽는 순서가 먼저다 — 캔버스가 최소로 따라간다). 줄이 화면 폭을 넘을 때만 보이는
  // 빈 자리로 가고, 그마저 없을 때만 그 옆자리로 가서 캔버스가 카드를 데리러 간다.
  if (keepsTheRow(asked, size, canvas.nodes, canvas.viewport)) return asked;
  return freePlaceInView(canvas.viewport, canvas.nodes) ?? asked;
}
