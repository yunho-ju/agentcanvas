// '고치기' 패널 — 기존 그래프에 objective를 주고, 제안문(왜 이렇게 바꾸자)과 후보를 읽고 승인한다.
// ArchitectPanel의 3상태 흐름을 물려받되, 제안문 표시가 핵심이고 빈 캔버스가 아니라 기존 그래프의 것이다.
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { useShapeName } from "./useShapeName";

export function OptimizePanel() {
  const spec = useEditor((state) => state.spec);
  const mode = useEditor((state) => state.optimizeMode);
  const objective = useEditor((state) => state.optimizeObjective);
  const proposal = useEditor((state) => state.optimizeProposal);
  const review = useEditor((state) => state.optimizeReview);
  // 두 카드가 같은 검사를 두 기준으로 읽지 않는다 (DESIGN §7 guided-architect-card).
  const canApply = Boolean(review?.passed);
  const candidate = useEditor((state) => state.optimizeCandidate);
  const error = useEditor((state) => state.optimizeError);
  const loading = useEditor((state) => state.optimizeLoading);
  const setObjective = useEditor((state) => state.setOptimizeObjective);
  const build = useEditor((state) => state.buildOptimizeCandidate);
  const reset = useEditor((state) => state.resetOptimize);
  const leave = useEditor((state) => state.leaveOptimizeMode);
  const apply = useEditor((state) => state.applyOptimizeCandidate);
  const locale = useLocale();
  const t = useT();
  const shapeName = useShapeName(proposal?.pattern_id);

  // 고칠 그래프가 없으면 서지 않는다 — Optimizer는 기존 그래프의 것이다(빈 캔버스는 Architect).
  if (mode === "closed" || spec === null) return null;

  return (
    <section
      className="optimize-panel layer"
      // 우측 기둥의 자리 규칙은 이 표식 하나로 받는다 (DESIGN §1 우측 레이어의 자리 나눔).
      data-mode-panel="optimize"
      aria-label={t("optimize.title")}
      aria-busy={loading}
    >
      {mode === "input" ? (
        <>
          <h2 className="optimize-panel__title">{t("optimize.title")}</h2>
          <p className="optimize-panel__description">{t("optimize.description")}</p>
          <label className="optimize-panel__label" htmlFor="optimize-objective">
            {t("optimize.objective.label")}
          </label>
          <textarea
            id="optimize-objective"
            className="control optimize-panel__objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder={t("optimize.objective.placeholder")}
            aria-describedby={error ? "optimize-error" : undefined}
            disabled={loading}
          />
          {loading ? (
            <p className="optimize-panel__status" role="status">
              {t("optimize.loading")}
            </p>
          ) : null}
          {error ? (
            <p id="optimize-error" className="optimize-panel__error" role="alert">
              {t(error)}
            </p>
          ) : null}
          <div className="optimize-panel__actions">
            <button
              type="button"
              className="button-primary"
              onClick={() => void build()}
              disabled={!objective.trim() || loading}
              title={
                !objective.trim()
                  ? t("optimize.build.disabled")
                  : t("optimize.build.hint")
              }
            >
              {t("optimize.build")}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={leave}
              disabled={loading}
              title={t("optimize.leave.hint")}
            >
              {t("optimize.leave")}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="optimize-panel__title">{t("optimize.review.title")}</h2>
          {/* 제안문이 핵심 — 왜 이렇게 바꾸자는지 먼저 읽힌다. */}
          {proposal ? (
            <div className="optimize-panel__proposal">
              <p className="optimize-panel__hypothesis">
                {localized(proposal.hypothesis, locale)}
              </p>
              <p className="optimize-panel__effect">
                <span className="optimize-panel__field-label">
                  {t("optimize.expectedEffect")}
                </span>
                {localized(proposal.expected_effect, locale)}
              </p>
              <p className="optimize-panel__targets">
                <span className="optimize-panel__field-label">
                  {t("optimize.targetNodes")}
                </span>
                {(proposal.target_nodes ?? []).join(", ") || t("optimize.targetNodes.none")}
                {/* 모양 칩은 표시이지 손잡이가 아니다 — 누를 것이 없다(DESIGN §7). */}
                {shapeName ? (
                  <span className="optimize-panel__shape">{shapeName}</span>
                ) : null}
              </p>
              <p className="optimize-panel__evidence">
                {proposal.evidence.batch_id
                  ? t("optimize.evidence.grounded", {
                      cases: proposal.evidence.cases ?? 0,
                      gaps: proposal.evidence.cases_with_gaps ?? 0,
                    })
                  : t("optimize.evidence.guess")}
              </p>
            </div>
          ) : null}
          <div
            className="optimize-panel__checks"
            aria-label={t("optimize.review.checks")}
          >
            {(["schema", "graph", "dryRun"] as const).map((key) => {
              const check = review?.[key];
              return (
                <div
                  className="optimize-panel__check"
                  key={key}
                  data-passed={check?.passed}
                >
                  <span aria-hidden="true">{check?.passed ? "✓" : "!"}</span>
                  <span>{t(`architect.check.${key}`)}</span>
                </div>
              );
            })}
          </div>
          <p className="optimize-panel__summary">
            {t("architect.summary", {
              nodes: candidate?.nodes.length ?? 0,
              edges: candidate?.edges.length ?? 0,
            })}
          </p>
          <div className="optimize-panel__actions">
            <button
              type="button"
              className="button-primary"
              onClick={apply}
              disabled={!canApply}
              title={canApply ? t("optimize.apply.hint") : t("architect.apply.disabled")}
            >
              {t("optimize.apply")}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={reset}
              title={t("optimize.back.hint")}
            >
              {t("optimize.back")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
