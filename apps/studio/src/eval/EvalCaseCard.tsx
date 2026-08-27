// 시험 한 줄 — node-card 문법 준용 (DESIGN §7 eval-case-card).
import { caseCardState, lastAttemptOutput } from "./caseState";
import { EvalCaseForm } from "./EvalCaseForm";
import type { EvalCase } from "../generated/eval_case";
import type { EvalBatch } from "../generated/eval_batch";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { attemptsForCase } from "./batchHistory";

const MARK: Record<string, string> = { passed: "✓", failed: "✕" };

/** 펼친 카드의 결과 토막 — 돌린 적 있는 케이스만(§7 갱신본), 마지막 회차의 답 그대로. */
function EvalCaseResult({ output }: { output: string }) {
  const t = useT();
  return (
    <div className="eval-case-card__result">
      <p className="eval-case-card__result-label">{t("eval.case.result.label")}</p>
      <p className="eval-case-card__result-output">
        {output === "" ? t("eval.case.result.empty") : output}
      </p>
    </div>
  );
}

function EvalAttemptList({ evalCase, batch }: { evalCase: EvalCase; batch: EvalBatch | null }) {
  const t = useT();
  const advanced = useEditor((state) => state.evalAdvanced);
  if (!advanced) return null;
  const result = batch?.results.find((item) => item.case_id === evalCase.id);
  if (!result) return null;
  return (
    <div className="eval-attempt-list" aria-label={t("eval.attempts.label")}>
      {attemptsForCase(batch, evalCase.id).map((attempt, index) => (
        <div className="eval-attempt-list__item" key={`${attempt.run_id}-${index}`}>
          <span className="eval-attempt-list__round">{t("eval.attempts.round", { round: index + 1 })}</span>
          <span className={attempt.passed ? "eval-attempt-list__passed" : "eval-attempt-list__failed"}>
            {attempt.passed ? "✓" : "✕"} {t(attempt.passed ? "eval.attempts.passed" : "eval.attempts.failed")}
          </span>
          <span className="eval-attempt-list__output">{attempt.output_text || t("eval.case.result.empty")}</span>
          <span className="eval-attempt-list__technical">{result.evaluator} · {result.evaluator_version} · {attempt.run_id}</span>
        </div>
      ))}
    </div>
  );
}

export function EvalCaseCard({ evalCase }: { evalCase: EvalCase }) {
  const draft = useEditor((state) => state.caseDraft);
  const running = useEditor((state) => state.batchStatus === "running");
  const batch = useEditor((state) => state.batch);
  const expandCase = useEditor((state) => state.expandCase);
  const t = useT();

  const expanded = draft?.id === evalCase.id;
  const state = caseCardState(evalCase.id, { running, batch });
  const output = lastAttemptOutput(evalCase.id, batch);

  return (
    <div
      className={`eval-case-card${expanded ? " eval-case-card--selected" : ""}`}
      data-state={state.kind}
    >
      <button
        type="button"
        className="eval-case-card__row"
        aria-expanded={expanded}
        onClick={() => expandCase(evalCase.id)}
      >
        {state.kind === "running" ? (
          <span className="eval-case-card__rail" aria-hidden="true" />
        ) : (
          <span className="eval-case-card__mark" aria-hidden="true">
            {MARK[state.kind] ?? ""}
          </span>
        )}
        <span className="eval-case-card__title">{evalCase.title}</span>
        {state.kind === "failed" ? (
          <span className="eval-case-card__caption">
            {t("eval.case.result.failed.count", { runs: state.runs, passed: state.passed })}
          </span>
        ) : null}
      </button>
      {state.kind === "failed" ? (
        <p className="eval-case-card__next">{t("eval.case.result.failed.next")}</p>
      ) : null}
      {/* 방금 돌린 결과가 먼저 보인다 — 결과 토막 → 편집 폼(지우기·저장 캡션은 폼 맨 아래) (DESIGN §7). */}
      {expanded && output !== undefined ? <EvalCaseResult output={output} /> : null}
      {expanded ? <EvalAttemptList evalCase={evalCase} batch={batch} /> : null}
      {expanded ? <EvalCaseForm /> : null}
    </div>
  );
}
