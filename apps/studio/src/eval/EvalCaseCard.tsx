// 시험 한 줄 — node-card 문법 준용 (DESIGN §7 eval-case-card).
import { type AttemptInQuestion, attemptInQuestion, caseCardState } from "./caseState";
import { answerSpread } from "./answerSpread";
import { EvalCaseForm } from "./EvalCaseForm";
import type { EvalCase } from "../generated/eval_case";
import type { EvalBatch } from "../generated/eval_batch";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { attemptsForCase } from "./batchHistory";

const MARK: Record<string, string> = { passed: "✓", failed: "✕" };

/**
 * 펼친 카드의 결과 토막 — 돌린 적 있는 케이스만(§7 갱신본), 화면이 말하는 그 회차의 답 그대로.
 * 여러 번 돌린 케이스는 어느 회차의 답인지도 말한다(빠진 말 토막이 같은 회차를 가리킨다).
 */
function EvalCaseResult({ shown }: { shown: AttemptInQuestion }) {
  const t = useT();
  return (
    <div className="eval-case-card__result">
      <p className="eval-case-card__result-label">
        {t("eval.case.result.label")}
        {shown.rounds > 1 ? (
          <span className="eval-case-card__result-round">
            {t("eval.case.result.round", { round: shown.round })}
          </span>
        ) : null}
      </p>
      <p className="eval-case-card__result-output">
        {shown.output === "" ? t("eval.case.result.empty") : shown.output}
      </p>
    </div>
  );
}

/**
 * 빠진 말 토막 — 그 회차에 없던 말을 서버가 적어 준 그대로 (DESIGN §7 eval-case-card).
 * 판정한 쪽이 근거도 적는다: 화면은 판정 규칙을 다시 구현하지 않는다(미러가 갈리면 모순 화면이 된다).
 * 근거가 비어 있는데 실패했다면(옛 배치) 그것도 말하고, 어디를 보면 되는지까지 말한다 —
 * ✕만 보여 주고 침묵하지 않는다.
 */
function EvalCaseMissing({ missing }: { missing: string[] }) {
  const t = useT();
  return (
    <div className="eval-case-card__missing">
      <p className="eval-case-card__missing-label">{t("eval.case.missing.label")}</p>
      {missing.length === 0 ? (
        <p className="eval-case-card__missing-none">{t("eval.case.missing.none")}</p>
      ) : (
        <ul className="eval-case-card__missing-list">
          {/* 같은 말을 두 번 적을 수 있다 — 계약이 막지 않으므로 자리(index)까지 열쇠에 넣는다. */}
          {missing.map((phrase, index) => (
            <li className="eval-case-card__missing-phrase" key={`${index}:${phrase}`}>
              {phrase}
            </li>
          ))}
        </ul>
      )}
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
  const shown = attemptInQuestion(evalCase.id, batch);
  const spread = answerSpread(evalCase.id, batch);

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
      {expanded && shown ? <EvalCaseResult shown={shown} /> : null}
      {/* 빠진 말은 결과 토막이 보여 주는 바로 그 회차의 답에서 나온다 — 답 A를 보여 주며 답 B를 따지지 않는다. */}
      {expanded && shown && state.kind === "failed" ? (
        <EvalCaseMissing missing={shown.missing} />
      ) : null}
      {/* 주의 신호는 판정이 아니라 관찰이다 — 통과한 케이스에만, 실패의 까닭 위에 겹쳐 놓지 않는다. */}
      {expanded && state.kind === "passed" && spread ? (
        <p className="eval-case-card__spread">
          {t("eval.case.spread", { rounds: spread.rounds, answers: spread.answers })}
        </p>
      ) : null}
      {expanded ? <EvalAttemptList evalCase={evalCase} batch={batch} /> : null}
      {expanded ? <EvalCaseForm /> : null}
    </div>
  );
}
