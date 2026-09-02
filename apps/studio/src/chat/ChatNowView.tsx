// 지금 대화 — 오간 말들과, 다음 말을 적는 자리 (DESIGN §7 chat-panel).
// 말의 뜻(답·실패·거절)은 chat/의 순수 함수가 읽는다 — 여기서는 그리기만 한다.
import { useEffect, useRef } from "react";
import type { AgentSpec } from "../generated/agent_spec";
import { useT } from "../i18n/useT";
import { chatAwaitingGate, chatIsElsewhere, chatIsWaiting } from "../store/chatSlice";
import { useEditor } from "../store/editor";
import { ChatGateCard } from "./ChatGateCard";
import { type ChatTurnState, chatEndWords, chatTurnEnd } from "./chatTurn";
import { nothingSaid } from "./threadHistory";

/** 오간 말 하나 — 사람의 말과, 그 말이 받은 것(답이든 까닭이든). */
function ChatTurnLines({ spec, turn }: { spec: AgentSpec; turn: ChatTurnState }) {
  const promote = useEditor((state) => state.promoteChatTurn);
  const t = useT();
  const end = chatTurnEnd(spec, turn);

  return (
    <div className="chat-turn">
      {/* 사람이 건넨 말 없이 시작한 실행도 대화 안에 남는다 — 빈 말풍선을 세우지 않는다. */}
      {nothingSaid(turn.said) ? (
        <p className="chat-turn__no-said">{t("chat.thread.noSaid")}</p>
      ) : (
        <p className="chat-bubble chat-bubble--said" aria-label={t("chat.said.you")}>
          {turn.said}
        </p>
      )}
      {end?.kind === "answer" ? (
        <p className="chat-bubble chat-bubble--answer" aria-label={t("chat.said.answer")}>
          {end.text}
        </p>
      ) : null}
      {end && end.kind !== "answer" ? (
        <p
          className="chat-bubble chat-bubble--failed"
          role="alert"
          aria-label={t("chat.said.failed")}
        >
          <span className="chat-bubble__mark" aria-hidden="true">
            !
          </span>
          {t(chatEndWords(end))}
        </p>
      ) : null}
      {/* 이 말을 시험으로 옮기는 길 — 끝난 말에만 선다(기다리는 대화를 버리는 길을 만들지 않는다). */}
      {turn.runId !== null && end !== null ? (
        <button
          type="button"
          className="button-ghost chat-turn__promote"
          onClick={() => promote(turn.id)}
          title={t("chat.turn.promote.hint")}
        >
          {t("chat.turn.promote")}
        </button>
      ) : null}
    </div>
  );
}

export function ChatNowView({ spec }: { spec: AgentSpec }) {
  const turns = useEditor((state) => state.chatTurns);
  const draft = useEditor((state) => state.chatDraft);
  const notice = useEditor((state) => state.chatNotice);
  const asking = useEditor((state) => state.chatDeleteAsking);
  const thread = useEditor((state) => state.chatThreadId);
  const waiting = useEditor(chatIsWaiting);
  // 다른 곳에서 도는 대화는 이 화면이 듣고 있지 않다 — 기다리는 줄을 세우지 않는다.
  const elsewhere = useEditor(chatIsElsewhere);
  const heldAt = useEditor(chatAwaitingGate);
  const setDraft = useEditor((state) => state.setChatDraft);
  const say = useEditor((state) => state.sayInChat);
  const stop = useEditor((state) => state.stopChatTurn);
  const startOver = useEditor((state) => state.newChatThread);
  const askToDelete = useEditor((state) => state.askToDeleteChat);
  const cancelDelete = useEditor((state) => state.cancelDeleteChat);
  const deleteThread = useEditor((state) => state.deleteChatThread);
  const t = useT();

  const draftIsEmpty = draft.trim() === "";
  const going = turns.at(-1);
  const field = useRef<HTMLTextAreaElement>(null);

  // 이 자리에 서면 곧장 말을 걸 수 있다 — 적는 자리로 왔다는 것은 적으러 왔다는 뜻이다.
  useEffect(() => {
    if (!field.current?.disabled) field.current?.focus();
  }, []);

  return (
    <>
      <div className="chat-panel__said" role="log" aria-label={t("chat.title")}>
        {turns.length === 0 ? (
          <p className="chat-panel__invite">{t("chat.empty")}</p>
        ) : null}
        {turns.map((turn) => (
          <ChatTurnLines key={turn.id} spec={spec} turn={turn} />
        ))}
        {/* 확인을 기다리면 그 자리에 승인 카드가 선다 — 실행 화면과 같은 문법이다. */}
        {heldAt && going ? <ChatGateCard nodeId={heldAt} events={going.events} /> : null}
        {waiting && !heldAt && !elsewhere ? (
          <p className="chat-panel__pending" role="status">
            <span className="chat-panel__dots" aria-hidden="true">
              …
            </span>
            {t("chat.waiting")}
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="chat-panel__notice" role="alert">
          {t(notice)}
        </p>
      ) : null}

      <label className="chat-panel__label" htmlFor="chat-said">
        {t("chat.said.label")}
      </label>
      <textarea
        ref={field}
        id="chat-said"
        className="control chat-panel__field"
        value={draft}
        onChange={(field) => setDraft(field.target.value)}
        placeholder={t("chat.said.placeholder")}
        disabled={waiting}
      />
      <div className="chat-panel__actions">
        <button
          type="button"
          className="button-primary chat-panel__send"
          onClick={() => void say()}
          disabled={waiting || draftIsEmpty}
          title={
            waiting
              ? t("chat.send.waiting")
              : draftIsEmpty
                ? t("chat.send.empty")
                : t("chat.send.hint")
          }
        >
          {t("chat.send")}
        </button>
        {/* 기다림에는 언제나 그만두는 길이 있다 — 그래야 지울 수 없는 대화가 생기지 않는다. */}
        {waiting ? (
          <button
            type="button"
            className="button-ghost chat-panel__stop"
            onClick={() => void stop()}
            title={t("chat.stop.hint")}
          >
            {t("chat.stop")}
          </button>
        ) : null}
      </div>

      <div className="chat-panel__thread">
        {asking ? (
          <>
            <p className="chat-panel__ask">{t("chat.delete.ask")}</p>
            <button
              type="button"
              className="button-ghost chat-panel__delete-yes"
              onClick={() => void deleteThread()}
            >
              {t("chat.delete.yes")}
            </button>
            <button
              type="button"
              className="button-ghost chat-panel__delete-back"
              onClick={cancelDelete}
            >
              {t("chat.delete.back")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button-ghost chat-panel__new"
              onClick={startOver}
              disabled={turns.length === 0}
              title={turns.length === 0 ? t("chat.new.none") : t("chat.new.hint")}
            >
              {t("chat.new")}
            </button>
            <button
              type="button"
              className="button-ghost chat-panel__delete"
              onClick={askToDelete}
              disabled={thread === null}
              title={thread === null ? t("chat.delete.none") : t("chat.delete.hint")}
            >
              {t("chat.delete")}
            </button>
          </>
        )}
      </div>
    </>
  );
}
