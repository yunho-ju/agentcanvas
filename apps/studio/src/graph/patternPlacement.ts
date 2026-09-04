// 모양이 새로 놓는 카드가 어디에 앉는가 (순수 함수, 설계 문서 D12).
// 이 규칙은 화면의 것이다 — 뷰포트를 아는 쪽만 정할 수 있어 엔진과 맞추지 않는다.
// 자리는 팔레트가 새 카드를 놓는 그 규칙(graph/placement.ts)에게 그대로 맡긴다: 값을 보내는
// 카드를 "고른 카드"로 건네면 그 카드 다음 자리에 같은 줄로 앉는다 — 읽는 순서를 지켜야
// 새로 그은 선이 앞뒤 카드를 가로지르지 않는다.
import type { PatchTemplate } from "../generated/pattern_def";
import { type Anchors, feedersOf } from "./patternAnchors";
import { type PlacedCard, type ViewBox, placeNewNode } from "./placement";

type Position = PlacedCard["position"];

/** 지금 캔버스 — 놓인 카드들과 보고 있는 화면. */
interface CanvasNow {
  nodes: PlacedCard[];
  viewport: ViewBox;
}

/**
 * 템플릿이 새로 놓는 카드마다 앉을 자리 — 값을 보내는 카드 다음, 그 줄에.
 * 보내는 카드가 아직 문서에 없으면(그런 템플릿이면) 팔레트가 빈 캔버스에 놓듯 화면 안에 앉는다.
 * 한 번의 놓기 안에서 앞서 배정한 자리도 찬 자리로 센다.
 */
export function placeNewNodes(
  template: PatchTemplate,
  anchors: Anchors,
  canvas: CanvasNow,
): Record<string, Position> {
  const spots: Record<string, Position> = {};
  const cards = [...canvas.nodes];
  const cardId = (anchor: string): string | undefined =>
    [spots[anchor] && anchor, anchors[anchor]].find(
      (id) => id !== undefined && cards.some((card) => card.id === id),
    );

  for (const op of template.filter((op) => op.op === "add_node")) {
    const feeder = feedersOf(op.node, template).map(cardId).find(Boolean) ?? null;
    const spot = placeNewNode({
      nodes: cards,
      selectedId: feeder,
      viewport: canvas.viewport,
    });
    spots[op.node] = spot;
    cards.push({ id: op.node, position: spot });
  }
  return spots;
}
