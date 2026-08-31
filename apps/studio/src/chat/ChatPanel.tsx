// 대화 — 내놓은 판에 말을 걸고 답을 받는 자리 (DESIGN §7 chat-panel).
// 캔버스는 배경에 그대로다: 이 패널은 우측 스택에 서고, 한 시점에 오가는 말은 하나다.
// 말의 뜻(답·실패·거절)은 chat/의 순수 함수가 읽는다 — 여기서는 그리기만 한다.
import type { AgentSpec } from "../generated/agent_spec";
import { useT } from "../i18n/useT";
import { chatAwaitingGate, chatIsWaiting, chatSpecOf } from "../store/chatSlice";
import { useEditor } from "../store/editor";
import { ChatGateCard } from "./ChatGateCard";
import { chatPinWords } from "./chatPin";
import { type ChatTurnState, chatEndWords, chatTurnEnd } from "./chatTurn";

/** 오간 말 하나 — 사람의 말과, 그 말이 받은 것(답이든 까닭이든). */
function ChatTurnLines({ spec, turn }: { spec: AgentSpec; turn: ChatTurnState }) {
  const t = useT();
  const end = chatTurnEnd(spec, turn);

  return (
    <div className="chat-turn">
      <p className="chat-bubble chat-bubble--said" aria-label={t("chat.said.you")}>
        {turn.said}
      </p>
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
    </div>
  );
}

export function ChatPanel() {
  const open = useEditor((state) => state.chatOpen);
  const spec = useEditor(chatSpecOf);
  const turns = useEditor((state) => state.chatTurns);
  const draft = useEditor((state) => state.chatDraft);
  const pin = useEditor((state) => state.chatPin);
  const notice = useEditor((state) => state.chatNotice);
  const asking = useEditor((state) => state.chatDeleteAsking);
  const thread = useEditor((state) => state.chatThreadId);
  const waiting = useEditor(chatIsWaiting);
  const heldAt = useEditor(chatAwaitingGate);
  const setDraft = useEditor((state) => state.setChatDraft);
  const say = useEditor((state) => state.sayInChat);
  const stop = useEditor((state) => state.stopChatTurn);
  const startOver = useEditor((state) => state.newChatThread);
  const askToDelete = useEditor((state) => state.askToDeleteChat);
  const cancelDelete = useEditor((state) => state.cancelDeleteChat);
  const deleteThread = useEditor((state) => state.deleteChatThread);
  const t = useT();

  // 말을 걸 판이 없으면 서지 않는다 — 빈 카드를 띄우지 않는다.
  if (!open || spec === null) return null;

  const nothingSaid = draft.trim() === "";
  const going = turns.at(-1);

  return (
    <section className="chat-panel layer" aria-label={t("chat.title")}>
      <header className="chat-panel__header">
        <h2 className="chat-panel__title">{t("chat.title")}</h2>
        {/* 어느 판과 이야기하는지는 대화가 붙잡은 그 판이 말한다 — 캔버스가 바뀌어도 그대로다. */}
        {pin ? <p className="chat-panel__pin">{t(chatPinWords(pin))}</p> : null}
      </header>

      <div className="chat-panel__said" role="log" aria-label={t("chat.title")}>
        {turns.length === 0 ? (
          <p className="chat-panel__invite">{t("chat.empty")}</p>
        ) : null}
        {turns.map((turn) => (
          <ChatTurnLines key={turn.id} spec={spec} turn={turn} />
        ))}
        {/* 확인을 기다리면 그 자리에 승인 카드가 선다 — 실행 화면과 같은 문법이다. */}
        {heldAt && going ? <ChatGateCard nodeId={heldAt} events={going.events} /> : null}
        {waiting && !heldAt ? (
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
          disabled={waiting || nothingSaid}
          title={
            waiting
              ? t("chat.send.waiting")
              : nothingSaid
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
    </section>
  );
}
