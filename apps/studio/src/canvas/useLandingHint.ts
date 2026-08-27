// 받아 줄 자리가 하나도 없는 드래그에 말을 건다 (C5) — 조용한 실패 금지 (DESIGN §9).
// 판정은 순수 함수(landingPorts)가 하고, 여기서는 언제 말할지만 정한다: 새로 쥔 포트마다 한 번.
import { useEffect, useRef } from "react";
import type { Position } from "../history/graphCommands";
import { msg } from "../i18n/messages";
import { useEditor } from "../store/editor";
import { landingPorts } from "./landingPorts";
import type { PortAddress } from "./portLink";

/** 지금 쥐고 있는 포트와 그 포트가 있는 캔버스 좌표. 끄는 동안 값이 그대로면 화면도 그대로다. */
export interface HeldPort extends PortAddress {
  x: number;
  y: number;
}

/** 연결을 끄는 동안 캔버스 라이브러리가 알려주는 것들. */
export interface ConnectionInProgress {
  inProgress: boolean;
  fromHandle: {
    nodeId: string;
    id?: string | null;
    type: "source" | "target";
  } | null;
  from: Position | null;
}

/** 라이브러리가 말하는 "끌고 있는 연결"을 우리 말로 — 끌고 있지 않으면 쥔 것도 없다. */
export function heldPortOf(connection: ConnectionInProgress): HeldPort | null {
  const { fromHandle, from } = connection;
  if (!connection.inProgress || !fromHandle || !fromHandle.id || !from) return null;
  return {
    nodeId: fromHandle.nodeId,
    portId: fromHandle.id,
    side: fromHandle.type,
    x: from.x,
    y: from.y,
  };
}

function keyOf(port: PortAddress): string {
  return `${port.nodeId}.${port.portId}.${port.side}`;
}

/** 쥔 포트가 갈 곳이 없으면 그 곁에서 말을 건다. 자리는 `screenOf`가 화면 좌표로 옮겨 준다. */
export function useLandingHint(
  held: HeldPort | null,
  screenOf: (at: Position) => Position,
): void {
  const showConnectionHint = useEditor((state) => state.showConnectionHint);
  const clearConnectionHint = useEditor((state) => state.clearConnectionHint);
  const spoken = useRef<string | null>(null);

  useEffect(() => {
    if (!held) {
      spoken.current = null;
      return;
    }
    // 쥐고 있는 동안 같은 말을 되풀이하지 않는다 — 새로 쥔 포트에만 말을 건다.
    const key = keyOf(held);
    if (spoken.current === key) return;
    spoken.current = key;
    // 이어 보라던 말이 예고한 일이 시작됐다 — 할 일을 다 한 말은 남지 않는다 (DESIGN §7).
    clearConnectionHint();

    if (landingPorts(useEditor.getState().exportSpec(), held).length > 0) return;
    showConnectionHint({
      message: msg("connection.nowhere", { port: held.portId }),
      tone: "warn",
      at: screenOf({ x: held.x, y: held.y }),
    });
  });
}
