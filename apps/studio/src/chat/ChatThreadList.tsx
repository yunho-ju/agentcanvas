// 지난 대화 목록 — 이 문서에서 오갔던 대화를 고르고, 열고, 지운다 (DESIGN §7 chat-panel).
// 한 줄이 무슨 말을 하는지는 threadWords의 순수 함수가 정한다: 여기서는 그리기만 한다.
// 되묻는 물음과 못 연 까닭은 **사람이 누른 그 줄 안**에서 말한다 — 되묻기 자리를 두 벌 만들지 않는다.
import type { ThreadSummary } from "../api/threads";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { threadCaption, threadTitle } from "./threadWords";

/** 대화 한 줄 — 열기와 지우기, 그리고 그 줄에서 시작된 물음과 까닭. */
function ChatThreadRow({ summary }: { summary: ThreadSummary }) {
  const asking = useEditor((state) => state.chatThreadDeleting);
  const opening = useEditor((state) => state.chatOpening);
  const trouble = useEditor((state) => state.chatOpenTrouble);
  const switchAsking = useEditor((state) => state.chatSwitchAsking);
  const open = useEditor((state) => state.openPastChat);
  const retryOpen = useEditor((state) => state.retryOpenPastChat);
  const confirmSwitch = useEditor((state) => state.confirmSwitchPastChat);
  const cancelSwitch = useEditor((state) => state.cancelSwitchPastChat);
  const askToDelete = useEditor((state) => state.askToDeletePastChat);
  const cancelDelete = useEditor((state) => state.cancelDeletePastChat);
  const deleteThread = useEditor((state) => state.deletePastChat);
  const locale = useLocale();
  const t = useT();

  const mine = summary.thread_id;
  const isOpening = opening === mine;
  // 하나를 여는 동안에는 다른 줄이 기다린다 — 어느 대답이 이길지 사람이 알 수 없게 만들지 않는다.
  const busy = opening !== null;

  return (
    <li className="chat-threads__row">
      <button
        type="button"
        className="chat-threads__open"
        onClick={() => void open(mine)}
        disabled={busy}
        title={busy ? t("chat.threads.opening.hint") : t("chat.threads.open.hint")}
      >
        <span className="chat-threads__said">{threadTitle(summary, locale)}</span>
        <span className="chat-threads__when">{threadCaption(summary, locale)}</span>
      </button>
      {/* 누르자마자 무슨 일이 일어나는지 말한다 (100ms 규칙). */}
      {isOpening ? (
        <p className="chat-threads__opening" role="status">
          {t("chat.threads.opening")}
        </p>
      ) : null}

      {/* 못 연 까닭과 다음 걸음은 누른 그 줄에서 말한다 (K5·K6). */}
      {trouble?.threadId === mine ? (
        <>
          <p className="chat-threads__trouble" role="alert">
            {t(trouble.why)}
          </p>
          <button
            type="button"
            className="chat-threads__retry"
            onClick={() => void retryOpen()}
          >
            {t("chat.thread.retry")}
          </button>
        </>
      ) : null}

      {/* 기다리는 말이 있는데 자리를 뜨려 하면 그 줄에서 한 번 더 묻는다 (L1). */}
      {switchAsking === mine ? (
        <>
          <p className="chat-threads__ask">{t("chat.threads.switch.ask")}</p>
          <button
            type="button"
            className="chat-threads__switch-yes"
            onClick={() => void confirmSwitch()}
            disabled={busy}
            title={busy ? t("chat.threads.opening.hint") : undefined}
          >
            {t("chat.threads.switch.yes")}
          </button>
          <button type="button" className="chat-threads__switch-back" onClick={cancelSwitch}>
            {t("chat.threads.switch.back")}
          </button>
        </>
      ) : null}

      {/* 지우기는 되돌릴 수 없다 — 같은 자리에서 한 번 더 묻는다(새 창 금지). */}
      {asking === mine ? (
        <>
          <p className="chat-threads__ask">{t("chat.delete.ask")}</p>
          <button
            type="button"
            className="chat-threads__delete-yes"
            onClick={() => void deleteThread()}
            disabled={busy}
            title={busy ? t("chat.threads.opening.hint") : undefined}
          >
            {t("chat.delete.yes")}
          </button>
          <button type="button" className="chat-threads__delete-back" onClick={cancelDelete}>
            {t("chat.delete.back")}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="chat-threads__delete"
          onClick={() => askToDelete(mine)}
          disabled={busy}
          title={busy ? t("chat.threads.opening.hint") : t("chat.threads.delete.hint")}
        >
          {t("chat.delete.yes")}
        </button>
      )}
    </li>
  );
}

export function ChatThreadList() {
  const threads = useEditor((state) => state.chatThreads);
  const failure = useEditor((state) => state.chatThreadsFailure);
  const deleteFailure = useEditor((state) => state.chatThreadDeleteFailure);
  const load = useEditor((state) => state.loadChatThreads);
  const t = useT();

  return (
    <div className="chat-threads">
      {/* 목록을 못 읽은 것은 한 대화를 못 읽은 것과 다른 일이라 다른 말을 하고, 손잡이도 목록의 것이다. */}
      {failure ? (
        <>
          <p className="chat-threads__trouble" role="alert">
            {t(failure)}
          </p>
          <button type="button" className="chat-threads__retry" onClick={() => void load()}>
            {t("chat.threads.retry")}
          </button>
        </>
      ) : null}

      {deleteFailure ? (
        <p className="chat-threads__trouble" role="alert">
          {t(deleteFailure)}
        </p>
      ) : null}

      {threads !== null && threads.length === 0 ? (
        <p className="chat-threads__invite">{t("chat.threads.empty")}</p>
      ) : null}
      {threads !== null && threads.length > 0 ? (
        <ul className="chat-threads__list">
          {threads.map((summary) => (
            <ChatThreadRow key={summary.thread_id} summary={summary} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
