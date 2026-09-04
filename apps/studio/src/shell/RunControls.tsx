// 우상단 — 실행 버튼과 그 옆의 검증 pill, 그 아래 실행에 넣을 값을 묻는 카드.
// 실행 직전에 확인할 것이 있으면 여기서 먼저 말한다.
import { useMemo } from "react";
import { nodesNeedingSetup } from "../graph/nodeSetupIssues";
import { useT } from "../i18n/useT";
import { useFocusInspector } from "../inspector/inspectorFocus";
import { RunInputCard } from "../run/RunInputCard";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { docBindings } from "../store/graphSlice";
import { docSkills } from "../store/skillSlice";

export function RunControls() {
  const spec = useEditor((state) => state.spec);
  // 실행하면 먼저 저장된다 — 그래야 실행 기록에 서버가 매긴 판이 적힌다.
  // 물을 것이 있는 문서에서는 먼저 카드가 서고, 실행은 그 뒤다.
  const requestRun = useEditor((state) => state.requestRun);
  const evalOpen = useEditor((state) => state.evalPanelOpen);
  const leaveEvalMode = useEditor((state) => state.leaveEvalMode);
  const running = useEditor(isRunning);
  // 저장이 오가는 동안에는 실행도 기다린다 — 저장한 그래프와 실행한 그래프가 어긋나지 않도록.
  const saving = useEditor((state) => state.saving);
  // 서버에 실행을 부탁해 둔 사이 — 아직 이벤트가 없어 실행처럼 보이지 않는 시간이다.
  const starting = useEditor((state) => state.startingRun);
  // 확인이 필요한 노드는 캔버스를 훑지 않아도 여기서 세어 준다 (디자인 언어 §2.4).
  const nodes = useEditor((state) => state.nodes);
  const select = useEditor((state) => state.select);
  const focusInspector = useFocusInspector();
  // 입은 skill이 문서에 있는지도 손볼 곳이다 — 뱃지와 같은 판정을 같은 재료로 읽는다.
  const skills = useEditor(docSkills);
  const bindings = useEditor(docBindings);
  const waiting = useMemo(
    () => nodesNeedingSetup(nodes, skills, bindings),
    [nodes, skills, bindings],
  );
  const t = useT();

  return (
    <div className="layer-top-right">
      <div className="run-controls layer">
        {/* 문제를 숨기지 않는다 — 실행 버튼 바로 옆에서 세고, 누르면 그 노드로 데려간다. */}
        {waiting.length > 0 && !running ? (
          <button
            type="button"
            className="run-controls__waiting"
            onClick={() => {
              select("node", waiting[0].id);
              focusInspector();
            }}
            title={t("run.waiting.hint")}
          >
            <span className="button__icon" aria-hidden="true">
              !
            </span>
            {t("run.waiting", { count: waiting.length })}
          </button>
        ) : null}
        <button
          type="button"
          className="run-controls__run"
          onClick={() => {
            if (evalOpen) leaveEvalMode();
            void requestRun();
          }}
          disabled={spec === null || running || saving || starting}
          title={
            saving
              ? t("save.caption.saving")
              : starting
                ? t("run.starting")
                : waiting.length > 0
                  ? t("run.waiting.blocked")
                  : t("mode.run.hint")
          }
        >
          <span className="button__icon" aria-hidden="true">
            ▶
          </span>
          {t("run.start")}
        </button>
      </div>
      {/* 물을 것이 있으면 실행 버튼 아래에서 묻는다 — 없으면 이 자리는 비어 있다. */}
      <RunInputCard />
    </div>
  );
}
