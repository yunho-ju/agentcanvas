// 대화 한가운데에서 사람 확인을 받는 자리 — 실행 화면의 gate-card와 **같은 문법·같은 말**이다
// (DESIGN §7 chat-panel: 새 카드 발명 금지). 무엇을 묻는지(양식·도구)는 두 화면이 같은 순수
// 함수(run/gateAsk)에서 읽고, 카드가 열렸는지·되묻는 중인지는 store가 안다 (Esc 체인이 봐야 한다).
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RunEvent } from "../generated/run_event";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { SchemaFields } from "../inspector/SchemaFields";
import { describeForm, missingRequired } from "../inspector/schemaForm";
import { withValue } from "../inspector/values";
import { resolveSchema } from "../registry/schemaCatalog";
import { gateSchemaRefIn, gateToolAskIn } from "../run/gateAsk";
import { useEditor } from "../store/editor";

export function ChatGateCard({ nodeId, events }: { nodeId: string; events: RunEvent[] }) {
  const open = useEditor((state) => state.chatGateCardOpen);
  const confirming = useEditor((state) => state.chatRejectAsking);
  const answering = useEditor((state) => state.chatAnswering);
  const approve = useEditor((state) => state.approveChatGate);
  const reject = useEditor((state) => state.rejectChatGate);
  const setOpen = useEditor((state) => state.setChatGateCardOpen);
  const askToReject = useEditor((state) => state.askToRejectChatGate);
  const cancelReject = useEditor((state) => state.cancelChatRejectGate);
  // 무엇을 승인하는지는 대화가 붙잡은 그 판의 연결 목록이 말해 준다.
  const toolAsk = useEditor(
    useShallow((state) =>
      gateToolAskIn(events, nodeId, state.chatSpec?.resources ?? state.publishedSpec?.resources ?? []),
    ),
  );
  const approveButton = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const locale = useLocale();
  const t = useT();

  const asked = resolveSchema(gateSchemaRefIn(events, nodeId));
  const drawn = asked ? describeForm(asked.schema) : undefined;
  const form = drawn && drawn.fields.length > 0 ? drawn : undefined;
  // 되묻는 물음을 오가는 동안에도 적어 둔 값은 카드가 들고 있다.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const unanswered = missingRequired(form?.fields ?? [], values);

  // 답을 기다리는 카드가 서면 손은 이미 승인 버튼 위에 있다 — 다시 묻는 동안에는 안전한 답 위에.
  useEffect(() => {
    if (!open) return;
    (confirming ? back : approveButton).current?.focus();
  }, [open, confirming]);

  // 카드를 닫아 둔 동안에도 돌아올 길은 남는다 — 그 말은 여전히 멈춰 있다.
  if (!open) {
    return (
      <button
        type="button"
        className="gate-card__button gate-card__reopen"
        onClick={() => setOpen(true)}
      >
        {t("gate.reopen")}
      </button>
    );
  }

  return (
    <div className="gate-card" role="dialog" aria-label={t("gate.label", { id: nodeId })}>
      <p className="gate-card__title">
        <span className="gate-card__mark" aria-hidden="true">
          ✋
        </span>
        {t("gate.title")}
      </p>
      {/* 도구를 부르기 전 확인이면 무엇을 승인하는지(어느 도구·무엇을 하는지) 말한다. */}
      {toolAsk && !confirming ? (
        <>
          <p className="gate-card__body">{t("gate.tool.body", { tool: toolAsk.toolName })}</p>
          {toolAsk.plainDescription ? (
            <p className="gate-card__tool-what">
              {localized(toolAsk.plainDescription, locale)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="gate-card__body">
          {confirming ? t("gate.reject.body") : t("gate.body")}
        </p>
      )}
      {/* 도구 승인은 적을 폼이 없다 — 무엇을 하는지만 말하고 허락·멈추기를 받는다. */}
      {!confirming && !toolAsk && form ? (
        <SchemaFields
          fields={form.fields}
          values={values}
          onChange={(name, value) => setValues(withValue(values, name, value))}
          block="gate-card"
          idPrefix="chat-gate"
        />
      ) : null}
      <div className="gate-card__actions">
        {confirming ? (
          <>
            <button
              type="button"
              className="gate-card__button gate-card__confirm"
              onClick={() => void reject()}
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
              ref={approveButton}
              className="gate-card__button gate-card__approve"
              // 답에 없던 말을 지어내지 않는다 — 적은 것이 없으면 값도 없다.
              onClick={() => void approve(Object.keys(values).length > 0 ? values : undefined)}
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
              onClick={() => setOpen(false)}
            >
              {t("gate.leave")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
