// 피커가 뜨는 순간의 규칙 (브리프 B4·B5). 캔버스 라이브러리의 이벤트를 우리 말로 옮긴다.
import type { PortAddress } from "./portLink";

/** 연결을 끌다 손을 놓은 순간, 캔버스 라이브러리가 알려주는 것들. */
export interface ConnectionRelease {
  isValid: boolean | null;
  toNode: { id: string } | null;
  fromHandle: { nodeId: string; id: string | null; type: "source" | "target" } | null;
}

/**
 * 빈 자리에 놓았다면 끌고 온 포트, 아니면 없다.
 * 노드 위에 놓은 연결은 평소의 잇기가 맡는다 — 이을 수 없었다면 그 이유를 그쪽이 말한다.
 */
export function releasedPort(release: ConnectionRelease): PortAddress | null {
  const { fromHandle } = release;
  if (release.toNode !== null || !fromHandle || !fromHandle.id) return null;
  return { nodeId: fromHandle.nodeId, portId: fromHandle.id, side: fromHandle.type };
}

/** 마우스로 눌렀든 손가락으로 짚었든, 화면에서 손이 놓인 한 점. */
export function pointerPosition(event: {
  clientX?: number;
  clientY?: number;
  changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
}): { x: number; y: number } {
  const touch = event.changedTouches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  return { x: event.clientX ?? 0, y: event.clientY ?? 0 };
}

/** 누른 곳이 아무것도 없는 캔버스 바닥인가 — 카드나 도구 위는 그 자리가 아니다. */
export function onEmptyCanvas(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains("react-flow__pane");
}
