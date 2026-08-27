// 잠긴 밸브 앞에서 사람이 답하는 자리 — 카드는 기다리는 노드 옆에 선다.
// 무엇을 기다리는지는 화면이 정하지 않는다: awaitingGate는 RunEvent에서 파생된 사실이다.
// 거절은 되돌릴 수 없으므로 한 번 더 묻는다 — 새 창을 띄우지 않고 이 카드 안에서 묻는다.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { SchemaFields } from "../inspector/SchemaFields";
import { describeForm, missingRequired } from "../inspector/schemaForm";
import { withValue } from "../inspector/values";
import { resolveSchema } from "../registry/schemaCatalog";
import { useEditor } from "../store/editor";
import { gateSchemaRef } from "../store/gateSlice";
import { awaitingGate } from "../store/runSlice";

export function GateCard({ nodeId }: { nodeId: string }) {
  const held = useEditor(awaitingGate) === nodeId;
  const open = useEditor((state) => state.gateCardOpen);
  const approveGate = useEditor((state) => state.approveGate);
  const rejectGate = useEditor((state) => state.rejectGate);
  const setGateCardOpen = useEditor((state) => state.setGateCardOpen);
  // 다시 묻는 물음이 열려 있다는 사실은 화면 밖도 안다 — Esc가 무엇을 먼저 무를지 정해야 하기 때문이다.
  const confirming = useEditor((state) => state.confirmingReject);
  const askToReject = useEditor((state) => state.askToReject);
  const cancelReject = useEditor((state) => state.cancelReject);
  // 답은 서버가 받는다 — 오가는 사이에는 답하는 버튼이 기다린다고 말한다 (조용한 무시 금지).
  const answering = useEditor((state) => state.answeringGate);
  const approve = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const t = useT();
  // 이 밸브가 요구한 형식을 카탈로그가 풀어 준다 — 못 풀면 폼 없이 답만 받는다.
  // 이름은 풀렸어도 그릴 항목이 하나도 없으면 사람에게는 못 찾은 것과 같다 (무언의 빈 폼 금지).
  const asked = resolveSchema(useEditor(gateSchemaRef));
  const drawn = asked ? describeForm(asked.schema) : undefined;
  const form = drawn && drawn.fields.length > 0 ? drawn : undefined;
  // 다시 묻는 물음을 오가는 동안에도 적어 둔 값은 카드가 들고 있다.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const unanswered = missingRequired(form?.fields ?? [], values);

  // 답을 기다리는 카드가 서면 손은 이미 승인 버튼 위에 있다 — 키보드만으로도 답할 수 있다.
  // 다시 묻는 동안에는 안전한 답 위에 손을 얹는다: 실수로 눌러도 아무 일도 일어나지 않는다.
  useEffect(() => {
    if (!held || !open) return;
    (confirming ? back : approve).current?.focus();
  }, [held, open, confirming]);

  if (!held) return null;

  // 카드를 닫아 둔 동안에도 돌아올 길은 남는다 — 실행은 여전히 멈춰 있다.
  if (!open) {
    return (
      <button
        type="button"
        className="gate-card__button gate-card__reopen nodrag"
        onClick={() => setGateCardOpen(true)}
      >
        {t("gate.reopen")}
      </button>
    );
  }

  return (
    <div
      className="gate-card nodrag"
      role="dialog"
      aria-label={t("gate.label", { id: nodeId })}
    >
      <p className="gate-card__title">
        <span className="gate-card__mark" aria-hidden="true">
          ✋
        </span>
        {t("gate.title")}
      </p>
      <p className="gate-card__body">{confirming ? t("gate.reject.body") : t("gate.body")}</p>
      {/* 다시 묻는 동안에는 그 물음만 남는다 — 적어 둔 값은 카드가 그대로 들고 있다. */}
      {!confirming &&
        (form ? (
          <SchemaFields
            fields={form.fields}
            values={values}
            onChange={(name, value) => setValues(withValue(values, name, value))}
            block="gate-card"
            idPrefix="gate"
          />
        ) : (
          <p className="gate-card__no-form">{t("gate.form.missing")}</p>
        ))}
      <div className="gate-card__actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="gate-card__button gate-card__confirm"
              onClick={rejectGate}
              disabled={answering}
              title={answering ? t("gate.answering") : undefined}
            >
              {t("gate.reject.confirm")}
            </button>
            <button
              type="button"
              ref={back}
              className="gate-card__button gate-card__back"
              onClick={cancelReject}
            >
              {t("gate.reject.back")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              ref={approve}
              className="gate-card__button gate-card__approve"
              // 답에 없던 말을 지어내지 않는다 — 적은 것이 없으면 값도 없다.
              onClick={() =>
                approveGate(Object.keys(values).length > 0 ? values : undefined)
              }
              disabled={answering || unanswered.length > 0}
              title={
                answering
                  ? t("gate.answering")
                  : unanswered.length > 0
                    ? t("gate.approve.blocked")
                    : undefined
              }
            >
              {t("gate.approve")}
            </button>
            <button
              type="button"
              className="gate-card__button gate-card__reject"
              onClick={askToReject}
              disabled={answering}
              title={answering ? t("gate.answering") : undefined}
            >
              {t("gate.reject")}
            </button>
            <button
              type="button"
              className="gate-card__button gate-card__leave"
              onClick={() => setGateCardOpen(false)}
            >
              {t("gate.leave")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
