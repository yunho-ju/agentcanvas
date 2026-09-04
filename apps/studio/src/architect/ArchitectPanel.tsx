import { stepsWearingSkills } from "./architect";
import { useT, useLocale } from "../i18n/useT";
import { useEditor } from "../store/editor";

export function ArchitectPanel() {
  const locale = useLocale();
  const asks = useEditor((state) => state.architectAsks);
  const askAt = useEditor((state) => state.architectAskAt);
  const answer = useEditor((state) => state.answerArchitectAsk);
  const skipped = useEditor((state) => state.architectSkippedPatterns);
  const spec = useEditor((state) => state.spec);
  const nodes = useEditor((state) => state.nodes);
  const mode = useEditor((state) => state.architectMode);
  const request = useEditor((state) => state.architectRequest);
  const draft = useEditor((state) => state.architectDraft);
  const review = useEditor((state) => state.architectReview);
  const error = useEditor((state) => state.architectError);
  const loading = useEditor((state) => state.architectLoading);
  const setRequest = useEditor((state) => state.setArchitectRequest);
  const build = useEditor((state) => state.buildArchitectDraft);
  const reset = useEditor((state) => state.resetArchitect);
  const skip = useEditor((state) => state.skipArchitect);
  const apply = useEditor((state) => state.applyArchitectDraft);
  const dropped = useEditor((state) => state.architectDroppedSkills);
  const t = useT();

  const asking = mode === "asking" ? asks[askAt] : undefined;
  if (mode === "closed" || spec !== null || nodes.length !== 0 || (mode === "review" && !draft)) return null;
  if (mode === "asking" && !asking) return null;
  const canApply = Boolean(review?.passed);
  const toFill = review?.toFill ?? 0;
  return (
    <section className="architect-panel layer" aria-label={t("architect.title")} aria-busy={loading}>
      {asking ? (
        <>
          {/* 제목이 그 물음이고 캡션이 그 대가다 — 두 문장 모두 서버 카탈로그의 것이다
              (DESIGN §7 pattern-asks: 화면이 문장을 짓지 않는다). */}
          <h2 className="architect-panel__title">{asking.question[locale]}</h2>
          <p className="architect-panel__description">{asking.cost[locale]}</p>
          <div className="architect-panel__actions">
            <button type="button" className="button-primary" onClick={() => answer("yes")}>{t("architect.ask.yes")}</button>
            <button type="button" className="button-ghost" onClick={() => answer("no")}>{t("architect.ask.no")}</button>
            <button type="button" className="button-ghost" onClick={() => answer("skipped")}>{t("architect.ask.skip")}</button>
            {/* 되돌아가는 길은 Esc와 마지막 질문의 '다시 적기'다 (DESIGN §7 pattern-asks). */}
            {askAt === asks.length - 1 ? (
              <button type="button" className="button-ghost" onClick={reset} title={t("architect.back.hint")}>{t("architect.back")}</button>
            ) : null}
          </div>
          <p className="architect-panel__ask-progress">{t("architect.ask.progress", { total: asks.length, index: askAt + 1 })}</p>
        </>
      ) : mode === "guided" ? (
        <>
          <h2 className="architect-panel__title">{t("architect.title")}</h2>
          <p className="architect-panel__description">{t("architect.description")}</p>
          <label className="architect-panel__label" htmlFor="architect-request">{t("architect.request.label")}</label>
          <textarea id="architect-request" className="control architect-panel__request" value={request} onChange={(event) => setRequest(event.target.value)} placeholder={t("architect.request.placeholder")} aria-describedby={error ? "architect-error" : undefined} disabled={loading} />
          {loading ? <p className="architect-panel__status" role="status">{t("architect.loading")}</p> : null}
          {error ? <p id="architect-error" className="architect-panel__error" role="alert">{t(error)}</p> : null}
          <div className="architect-panel__actions">
            <button type="button" className="button-primary" onClick={() => void build()} disabled={!request.trim() || loading} title={!request.trim() ? t("architect.create.disabled") : t("architect.create.hint")}>{t("architect.create")}</button>
            <button type="button" className="button-ghost" onClick={skip} disabled={loading} title={t("architect.skip.hint")}>{t("architect.skip")}</button>
          </div>
        </>
      ) : (
        <>
          <h2 className="architect-panel__title">{t("architect.review.title")}</h2>
          <p className="architect-panel__request-summary">{request}</p>
          {/* 예고한 일이 일어나지 않았는데 아무 말도 없는 길을 만들지 않는다 (§9). */}
          {skipped.map((shape) => (
            <p className="architect-panel__skipped" key={shape.pattern_id} data-tone="warn">
              <span aria-hidden="true">!</span>{" "}
              <span>{t("architect.ask.skipped", { why: shape.why[locale] })}</span>
            </p>
          ))}
          <div className="architect-panel__checks" aria-label={t("architect.review.checks")}>
            {(["schema", "graph", "dryRun"] as const).map((key) => {
              const check = review?.[key];
              return <div className="architect-panel__check" key={key} data-passed={check?.passed}><span aria-hidden="true">{check?.passed ? "✓" : "!"}</span><span>{t(`architect.check.${key}`)}</span></div>;
            })}
          </div>
          <p className="architect-panel__summary">{t("architect.summary", { nodes: draft?.nodes.length ?? 0, edges: draft?.edges.length ?? 0 })}</p>
          <p className="architect-panel__to-fill" data-tone={toFill > 0 ? "warn" : "ok"}>
            <span aria-hidden="true">{toFill > 0 ? "!" : "✓"}</span>{" "}
            <span>{t("architect.toFill", { count: toFill })}</span>
            {toFill > 0 ? <span className="architect-panel__to-fill-hint">{t("architect.toFill.hint")}</span> : null}
          </p>
          {/* 어느 단계가 무엇을 따르는지 (DESIGN §7 guided-architect-card 보강).
              채워야 할 칸 셈과는 무관하다 — skill은 비어도 실행된다. */}
          {draft && stepsWearingSkills(draft).length > 0 ? (
            <ul className="architect-panel__steps">
              {stepsWearingSkills(draft).map((step) => (
                <li className="architect-panel__step" key={step.node}>
                  <span className="architect-panel__step-name">{step.node}</span>
                  <span className="architect-panel__step-skills">
                    {t("architect.stepSkills", { skills: step.skills.join(", ") })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {/* 조용히 빼지 않는다 — 무엇이 빠졌는지 말한다 (§9). */}
          {dropped > 0 ? (
            <p className="architect-panel__dropped">{t("architect.skillsDropped")}</p>
          ) : null}
          <div className="architect-panel__actions">
            <button type="button" className="button-primary" onClick={apply} disabled={!canApply} title={!canApply ? t("architect.apply.disabled") : t("architect.apply.hint")}>{t("architect.apply")}</button>
            <button type="button" className="button-ghost" onClick={reset} title={t("architect.back.hint")}>{t("architect.back")}</button>
          </div>
        </>
      )}
    </section>
  );
}
