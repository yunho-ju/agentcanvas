import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";

export function ArchitectPanel() {
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
  const t = useT();

  if (mode === "closed" || spec !== null || nodes.length !== 0 || (mode === "review" && !draft)) return null;
  const canApply = Boolean(review?.passed);
  const toFill = review?.toFill ?? 0;
  return (
    <section className="architect-panel layer" aria-label={t("architect.title")} aria-busy={loading}>
      {mode === "guided" ? (
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
          <div className="architect-panel__actions">
            <button type="button" className="button-primary" onClick={apply} disabled={!canApply} title={!canApply ? t("architect.apply.disabled") : t("architect.apply.hint")}>{t("architect.apply")}</button>
            <button type="button" className="button-ghost" onClick={reset} title={t("architect.back.hint")}>{t("architect.back")}</button>
          </div>
        </>
      )}
    </section>
  );
}
