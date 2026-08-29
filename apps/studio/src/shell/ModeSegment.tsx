// 상단 중앙의 모드 세그먼트 — 지금 만드는 중인지 보는 중인지가 한눈에 보이고, 오가는 길도 여기다.
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export function ModeSegment() {
  const spec = useEditor((state) => state.spec);
  const running = useEditor(isRunning);
  // 실행으로 드는 문은 하나다 — 실행 버튼과 똑같이, 물을 것이 있으면 먼저 묻고 그다음 저장·실행이다.
  const requestRun = useEditor((state) => state.requestRun);
  // 서버에 실행을 부탁해 둔 사이 — 아직 이벤트가 없어 실행처럼 보이지 않는 시간이다.
  const starting = useEditor((state) => state.startingRun);
  // 저장이 오가는 동안에는 카드를 열지 않는다 — 실행 버튼과 같은 잠금이다 (DESIGN §7 run-input-card).
  const saving = useEditor((state) => state.saving);
  const stopRun = useEditor((state) => state.stopRun);
  // 시험 패널이 열려 있는가 — 이 세그먼트에서만 열고 닫는다 (모드 이탈 시 패널 닫힘, DESIGN §7 eval-panel).
  const evalOpen = useEditor((state) => state.evalPanelOpen);
  const enterEvalMode = useEditor((state) => state.enterEvalMode);
  const leaveEvalMode = useEditor((state) => state.leaveEvalMode);
  // 지금 그래프를 고치는 중인가 — 이 세그먼트에서만 열고 닫는다 (OPT-1).
  const optimizeOpen = useEditor((state) => state.optimizeMode !== "closed");
  const enterOptimizeMode = useEditor((state) => state.enterOptimizeMode);
  const leaveOptimizeMode = useEditor((state) => state.leaveOptimizeMode);
  const t = useT();

  return (
    <div className="mode-segment layer" role="group" aria-label={t("mode.label")}>
      <button
        type="button"
        className="mode-segment__option"
        aria-pressed={!running && !evalOpen}
        title={t("mode.build.hint")}
        onClick={() => {
          if (running) stopRun();
          if (evalOpen) leaveEvalMode();
          if (optimizeOpen) leaveOptimizeMode();
        }}
      >
        {t("mode.build")}
      </button>
      <button
        type="button"
        className="mode-segment__option"
        aria-pressed={running}
        disabled={spec === null || saving || starting}
        title={
          spec === null
            ? t("mode.run.none")
            : saving
              ? t("save.caption.saving")
              : starting
                ? t("run.starting")
                : t("mode.run.hint")
        }
        onClick={() => {
          if (running) return;
          if (evalOpen) leaveEvalMode();
          void requestRun();
        }}
      >
        {t("mode.run")}
      </button>
      <button
        type="button"
        className="mode-segment__option"
        aria-pressed={evalOpen}
        title={t("mode.eval.hint")}
        onClick={() => (evalOpen ? leaveEvalMode() : enterEvalMode())}
      >
        {t("mode.eval")}
      </button>
      <button
        type="button"
        className="mode-segment__option"
        aria-pressed={optimizeOpen}
        disabled={spec === null}
        title={spec === null ? t("mode.optimize.none") : t("mode.optimize.hint")}
        onClick={() => {
          if (optimizeOpen) {
            leaveOptimizeMode();
            return;
          }
          if (evalOpen) leaveEvalMode();
          enterOptimizeMode();
        }}
      >
        {t("mode.optimize")}
      </button>
    </div>
  );
}
