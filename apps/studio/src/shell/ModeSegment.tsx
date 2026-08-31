// 상단 중앙의 모드 세그먼트 — 지금 만드는 중인지 보는 중인지가 한눈에 보이고, 오가는 길도 여기다.
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { chatDoorTrouble } from "../chat/chatEntry";
import { useT } from "../i18n/useT";
import { chatDoor } from "../store/chatSlice";
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
  // 대화 문 앞의 사실들 — 열 수 있는지, 못 열면 왜인지는 순수 함수가 답한다 (CHAT-3b F1~F4).
  const chatOpen = useEditor((state) => state.chatOpen);
  const enterChatMode = useEditor((state) => state.enterChatMode);
  const leaveChatMode = useEditor((state) => state.leaveChatMode);
  const publication = useEditor((state) => state.publication);
  const publishedSpec = useEditor((state) => state.publishedSpec);
  const loadPublishedSpec = useEditor((state) => state.loadPublishedSpec);
  const retryPublishedSpec = useEditor((state) => state.retryPublishedSpec);
  // 문 판정은 한 자리에서만 난다 — 버튼도 패널도 같은 사실(chatDoor)을 본다.
  const chatTrouble = chatDoorTrouble(useEditor(useShallow(chatDoor)));
  // 못 읽은 판은 다시 읽어 볼 수 있다 — 잠긴 채로 두지 않는다 (비활성 대신 다시 확인).
  const chatCanRetry = chatTrouble?.block === "checkFailed";
  // 지금 그래프를 고치는 중인가 — 이 세그먼트에서만 열고 닫는다 (OPT-1).
  const optimizeOpen = useEditor((state) => state.optimizeMode !== "closed");
  const enterOptimizeMode = useEditor((state) => state.enterOptimizeMode);
  const leaveOptimizeMode = useEditor((state) => state.leaveOptimizeMode);
  const t = useT();

  // 내놓은 판이 바뀌거나 손에서 놓았으면 그 판의 몸통을 다시 읽는다 — 문의 판정은 그 판의 것이어야 한다.
  // (못 읽은 판을 저 혼자 다시 두드리지는 않는다 — 그 규칙은 store가 지킨다.)
  useEffect(() => {
    void loadPublishedSpec();
  }, [publication?.revision, publishedSpec, loadPublishedSpec]);

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
          if (chatOpen) leaveChatMode();
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
      <button
        type="button"
        className="mode-segment__option"
        aria-pressed={chatOpen}
        disabled={chatTrouble !== null && !chatCanRetry}
        title={chatTrouble ? t(chatTrouble.words) : t("mode.chat.hint")}
        onClick={() => {
          // 못 읽어서 못 여는 자리라면, 누르는 일은 '다시 확인해 보기'다.
          if (chatCanRetry) {
            void retryPublishedSpec();
            return;
          }
          if (chatOpen) {
            leaveChatMode();
            return;
          }
          // 우측 자리는 하나다 — 대화를 열면 다른 모드 패널은 물러난다 (DESIGN §1 배치표).
          if (evalOpen) leaveEvalMode();
          if (optimizeOpen) leaveOptimizeMode();
          enterChatMode();
        }}
      >
        {t("mode.chat")}
      </button>
    </div>
  );
}
