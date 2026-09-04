// 처음 온 사람이 걷는 네 걸음을 우측 스택의 마지막에서 말한다 (DESIGN §7 first-steps-card).
// 걸음은 그래프에서 파생하고, 다 걸으면 스스로 물러난다.
import { useEffect, useMemo, useRef, useState } from "react";
import { motionDurationMs } from "../canvas/motion";
import { nodesNeedingSetup } from "../graph/nodeSetupIssues";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { modePanelOpen } from "../store/modePanels";
import { sawRunToTheEnd } from "../store/runSlice";
import { docBindings } from "../store/graphSlice";
import { docSkills } from "../store/skillSlice";
import { type FirstStep, type FirstStepKey, currentStep, firstSteps } from "./firstSteps";

const DONE_MARK = "✓";

/** 걸음 하나가 지금 어떤 상태인가 — 기호와 색이 함께 이 값을 따라간다. */
function stateOf(step: FirstStep, now: FirstStepKey | null): string {
  if (step.done) return "done";
  return step.key === now ? "now" : "later";
}

export function FirstStepsCard() {
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  // 채울 것이 남았는지에는 입은 skill이 문서에 있는지도 든다 — 뱃지·pill과 같은 판정이다.
  const skills = useEditor(docSkills);
  const bindings = useEditor(docBindings);
  const runFinished = useEditor(sawRunToTheEnd);
  // 우측 스택에 모드 패널이 서 있으면 안내는 한 줄로 물러난다 (DESIGN §1 우측 레이어의 자리 나눔).
  const panelOpen = useEditor(modePanelOpen);
  const [expanded, setExpanded] = useState(false);
  const dismissed = useEditor((state) => state.firstStepsDismissed);
  const celebrating = useEditor((state) => state.firstStepsCelebrating);
  const celebrate = useEditor((state) => state.celebrateFirstSteps);
  const dismiss = useEditor((state) => state.dismissFirstSteps);
  const t = useT();

  const steps = useMemo(
    () =>
      firstSteps({
        nodeCount: nodes.length,
        edgeCount: edges.length,
        needsSetupCount: nodesNeedingSetup(nodes, skills, bindings).length,
        runFinished,
      }),
    [nodes, edges, skills, runFinished],
  );
  const now = currentStep(steps);
  const before = useRef(now);

  // 축하는 걷던 카드가 완주로 **전이**했을 때의 것이다 — 이미 다 걸은 자리에서 처음 서면 할 말이 없다.
  useEffect(() => {
    const walking = before.current;
    before.current = now;
    if (dismissed || celebrating) return;
    if (now === null && walking !== null) celebrate();
  }, [now, dismissed, celebrating, celebrate]);

  // 펼침은 그 패널 앞에서의 일이다 — 패널이 물러나면 다음 패널은 다시 한 줄에서 만난다.
  useEffect(() => {
    if (!panelOpen) setExpanded(false);
  }, [panelOpen]);

  // 축하는 읽을 만큼만 머문다 — 그 뒤로 이 안내는 다시 오지 않는다.
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(dismiss, motionDurationMs("--dur-hint"));
    return () => clearTimeout(timer);
  }, [celebrating, dismiss]);

  if (dismissed || (now === null && !celebrating)) return null;

  if (celebrating) {
    return (
      <section className="first-steps layer" aria-label={t("guide.title")}>
        <p className="first-steps__cheer">
          <span className="first-steps__mark" aria-hidden="true">
            {DONE_MARK}
          </span>
          {t("guide.done")}
        </p>
      </section>
    );
  }

  const folded = panelOpen && !expanded;
  const walked = steps.filter((step) => step.done).length;

  return (
    <section className="first-steps layer" aria-label={t("guide.title")}>
      {/* 패널이 서 있으면 제목 줄이 여닫는 손잡이가 된다 — 접힘은 걸음을 잊는 것이 아니다. */}
      {panelOpen ? (
        <button
          type="button"
          className="first-steps__collapsed"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          title={t(expanded ? "guide.collapse.hint" : "guide.expand.hint")}
        >
          <span className="first-steps__title">{t("guide.title")}</span>
          <span className="first-steps__walked">
            {walked}/{steps.length}
          </span>
        </button>
      ) : (
        <p className="first-steps__title">{t("guide.title")}</p>
      )}
      {folded ? null : (
        <>
          <ol className="first-steps__steps">
            {steps.map((step, order) => (
              <li
                key={step.key}
                className="first-steps__step"
                data-step={step.key}
                data-state={stateOf(step, now)}
              >
                <span className="first-steps__mark" aria-hidden="true">
                  {step.done ? DONE_MARK : order + 1}
                </span>
                <span className="first-steps__todo">{t(`guide.step.${step.key}`)}</span>
                {/* 방법은 지금 걸음에게만 딸린다 — 네 줄이 한꺼번에 말하면 무엇부터 할지 모른다. */}
                {step.key === now ? (
                  <span className="first-steps__how">{t(`guide.how.${step.key}`)}</span>
                ) : null}
              </li>
            ))}
          </ol>
          <button type="button" className="first-steps__hide" onClick={dismiss}>
            {t("guide.hide")}
          </button>
        </>
      )}
    </section>
  );
}
