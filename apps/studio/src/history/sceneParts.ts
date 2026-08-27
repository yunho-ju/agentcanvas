// 장면에서 조각을 떼어 내고 있던 자리에 되돌려 놓는 방법 — 명령들이 함께 쓰는 순수 도구.
import type { Scene } from "../graph/scene";

interface Placed<T> {
  index: number;
  item: T;
}

/**
 * 선택·드래그 표시와 **화면이 잰 치수**는 지금 화면의 사정일 뿐 편집의 일부가 아니다.
 * 명령이 기억하는 노드/연결에서는 떼어 낸다 — 되돌리기가 옛 선택을 되살리면 안 되고,
 * 옛 치수를 안고 돌아온 노드는 캔버스가 "이미 다 잰 것"으로 여겨 포트 자리를 다시 재지 않는다
 * (그러면 그 노드에 걸린 연결선이 끝점을 찾지 못해 그려지지 않는다).
 */
export function withoutScreenState<T>(item: T): T {
  const { selected, dragging, measured, handles, internals, ...rest } = item as T & {
    selected?: boolean;
    dragging?: boolean;
    measured?: unknown;
    handles?: unknown;
    internals?: unknown;
  };
  return rest as T;
}

/** 지금 어디에 있었는지까지 함께 기억한 조각들 — 되돌리기가 같은 자리에 꽂기 위해서다. */
export function placed<T extends { id: string }>(items: T[], ids: string[]): Placed<T>[] {
  return items.flatMap((item, index) =>
    ids.includes(item.id) ? [{ index, item: withoutScreenState(item) }] : [],
  );
}

export function restored<T>(items: T[], removed: Placed<T>[]): T[] {
  const next = [...items];
  for (const { index, item } of [...removed].sort((a, b) => a.index - b.index)) {
    next.splice(Math.min(index, next.length), 0, item);
  }
  return next;
}

/** 노드 하나와 거기 걸린 연결을 뺀 장면. 계약에 주인 없는 연결은 존재할 수 없다. */
export function withoutNode(scene: Scene, nodeId: string): Scene {
  return {
    ...scene,
    nodes: scene.nodes.filter((node) => node.id !== nodeId),
    edges: scene.edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    ),
  };
}
