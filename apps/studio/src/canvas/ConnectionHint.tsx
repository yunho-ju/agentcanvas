// 연결이 안 되는 이유를 손이 있는 자리에서 말한다 (DESIGN §7 connection-hint).
// 스스로 사라지고, 한 번에 하나이며, 다음 행동을 가로막지 않는다.
// 포트를 가리키는 말은 그 포트 곁에 선다 — 실제 자리는 브라우저만 알기에 여기서 재고,
// 재고 나서의 산수는 순수 함수(hintAnchor·portPoint)가 한다 (jsdom은 자리를 재지 못한다).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Position } from "../history/graphCommands";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { hintAnchor, type HintBox, portPoint } from "./hintAnchor";
import { motionDurationMs, tokenLengthPx } from "./motion";
import type { PortAddress } from "./portLink";
import { TONE_MARK } from "./toneMark";

const NOT_MEASURED: HintBox = { width: 0, height: 0 };

/**
 * 말은 노드를 놓는 그 전이에서 서지만, 캔버스는 새 노드의 손잡이를 그다음 커밋에 붙인다 —
 * 그래서 못 찾은 포트는 몇 프레임만 더 찾아본다. 그 안에 나타나지 않으면 그만둔다(폴링 금지).
 * 실브라우저에서 새 노드의 손잡이는 서너 프레임보다 늦게 붙을 수 있다(측정·재렌더 경유) —
 * 반 초 남짓이면 충분하고, 한도가 다하면 손이 있던 자리로 말한다.
 */
export const FRAMES_TO_LOOK = 30;

/**
 * 화면에 그려진 그 포트를 찾아 표면 안의 자리로 — 아직 없으면 null.
 * 포트 이름은 계약이 정한 id라 선택자에 그대로 끼운다(두 번째 사용처가 생기면 CSS.escape가 필요하다).
 */
function drawnPortPoint(port: PortAddress, surface: Element | null): Position | null {
  const handle = surface?.querySelector(
    `.react-flow__handle.${port.side}[data-nodeid="${port.nodeId}"][data-handleid="${port.portId}"]`,
  );
  if (!handle || !surface) return null;
  return portPoint(handle.getBoundingClientRect(), surface.getBoundingClientRect());
}

export function ConnectionHint() {
  const hint = useEditor((state) => state.connectionHint);
  const clearConnectionHint = useEditor((state) => state.clearConnectionHint);
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HintBox>(NOT_MEASURED);
  const [surface, setSurface] = useState<HintBox>(NOT_MEASURED);
  const [spoken, setSpoken] = useState<Position | null>(null);
  const t = useT();

  // 어디에 설지는 제 크기와 캔버스의 크기를 재 봐야 안다 (가장자리에서는 안쪽으로).
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    setBox({ width: element.offsetWidth, height: element.offsetHeight });
    const parent = element.parentElement;
    setSurface({
      width: parent?.clientWidth ?? 0,
      height: parent?.clientHeight ?? 0,
    });
    // 가리키는 포트가 있으면 그 곁으로 — 그 포트가 화면 어디에 있는지는 여기서만 알 수 있다.
    setSpoken(null);
    const port = hint?.port;
    if (!port) return;

    let left = FRAMES_TO_LOOK;
    let frame = 0;
    const look = () => {
      const at = drawnPortPoint(port, parent);
      if (at) return setSpoken(at);
      // 아직 그려지지 않았다 — 몇 프레임만 더 본다. 그 뒤로는 손이 있던 자리에서 말한다.
      if (left > 0) {
        left -= 1;
        frame = requestAnimationFrame(look);
      }
    };
    look();
    // 말이 갈아타면 앞의 말이 찾던 자리는 그만 찾는다.
    return () => cancelAnimationFrame(frame);
  }, [hint]);

  // 실패는 사용자가 치워야 할 쓰레기가 아니다 — 읽을 만큼 머물고 스스로 물러난다.
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(clearConnectionHint, motionDurationMs("--dur-hint"));
    return () => clearTimeout(timer);
  }, [hint, clearConnectionHint]);

  if (!hint) return null;

  // 가리킨 포트를 찾지 못했으면 손이 있던 자리에서 말한다 — 입을 다물지 않는다 (DESIGN §9).
  const at = hintAnchor(spoken ?? hint.at, surface, box, tokenLengthPx("--space-2"));
  return (
    <div
      ref={card}
      className="connection-hint"
      data-tone={hint.tone}
      role="alert"
      style={{ left: at.left, top: at.top }}
    >
      <span className="connection-hint__mark" aria-hidden="true">
        {TONE_MARK[hint.tone]}
      </span>
      <span className="connection-hint__message">{t(hint.message)}</span>
    </div>
  );
}
