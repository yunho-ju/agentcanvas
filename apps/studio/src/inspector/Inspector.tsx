// 고른 것의 설정을 보여주는 플로팅 카드. 무엇이 선택돼 있느냐만 보고 알맞은 폼을 건다.
// 고른 것이 없으면 카드 자체가 없다 — 빈 패널은 캔버스의 자리를 뺏을 뿐이다.
import type { RefObject } from "react";
import { ImpactPreview } from "../canvas/ImpactPreview";
import { useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { selectedEdge, selectedNode, useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { EdgeInspector } from "./EdgeInspector";
import { NodeInspector } from "./NodeInspector";

export function Inspector({ panelRef }: { panelRef?: RefObject<HTMLElement> }) {
  const node = useEditor(selectedNode);
  const edge = useEditor(selectedEdge);
  const pending = useEditor((state) => state.pendingDetach);
  const clearSelection = useEditor((state) => state.clearSelection);
  const running = useEditor(isRunning);
  const t = useT();

  if (pending === null && node === undefined && edge === undefined) return null;

  return (
    <aside
      className="inspector layer"
      aria-label={t("inspector.label")}
      ref={panelRef}
      tabIndex={-1}
    >
      {/* 답을 기다리는 물음이 있으면 그것이 먼저다 — 그 카드는 자기 답 버튼을 스스로 들고 있다. */}
      {pending !== null ? (
        <ImpactPreview nodeId={pending} />
      ) : (
        <>
          <button
            type="button"
            className="icon-button inspector__close"
            aria-label={t("inspector.close")}
            title={t("inspector.close.hint")}
            onClick={clearSelection}
          >
            <span aria-hidden="true">✕</span>
          </button>
          {running ? <p className="inspector__locked">{t(LOCKED_HINT)}</p> : null}
          {/* 실행을 보는 동안 설정은 읽기만 한다 — 잠긴 폼은 글자도 받지 않는다. */}
          <fieldset className="inspector__fields" disabled={running}>
            {node ? <NodeInspector node={node} /> : null}
            {node === undefined && edge ? <EdgeInspector edge={edge} /> : null}
          </fieldset>
        </>
      )}
    </aside>
  );
}
