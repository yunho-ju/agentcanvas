// 브라우저 화면의 한 점을 캔버스 표면 안의 자리로 — 피커와 연결 안내가 서는 좌표계다.
// 표면(.canvas)이 자리의 기준이 되도록 app.css가 그것을 position: relative로 세워 둔다.
import type { Position } from "../history/graphCommands";

/** 표면이 화면 어디에서 시작하는가 (getBoundingClientRect의 왼쪽 위). */
export interface SurfaceEdge {
  left: number;
  top: number;
}

/** 아직 표면을 재지 못했으면(첫 그리기 전) 자리를 지어내지 않고 그대로 둔다. */
export function surfacePoint(client: Position, surface: SurfaceEdge | undefined): Position {
  return { x: client.x - (surface?.left ?? 0), y: client.y - (surface?.top ?? 0) };
}
