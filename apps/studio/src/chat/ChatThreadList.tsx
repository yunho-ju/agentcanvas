// 지난 대화 목록 — 이 문서에서 오갔던 대화를 고르고, 열고, 지운다 (DESIGN §7 chat-panel).
// 한 줄이 무슨 말을 하는지는 threadWords의 순수 함수가 정한다: 여기서는 그리기만 한다.
// 되묻는 물음과 못 연 까닭은 **사람이 누른 그 줄 안**에서 말한다 — 되묻기 자리를 두 벌 만들지 않는다.
import type { ThreadSummary } from "../api/threads";
import { useLocale, useT } from "../i18n/useT";
import { chatNothingToFix } from "../store/chatFixSpotSlice";
import { chatIsWaiting } from "../store/chatSlice";
import { useEditor } from "../store/editor";
import type { FixSpot } from "./fixSpots";
import { fixSpotHint, fixSpotSummary, fixSpotWords } from "./fixSpotWords";
import { threadCaption, threadTitle } from "./threadWords";

/** 아직 훑지 못한 대화 — 새 배열을 매번 짓지 않도록 한 자리를 나눠 쓴다. */
const NOT_SCANNED: FixSpot[] = [];

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
  const spots = useEditor((state) => state.chatFixSpots[mine]?.spots ?? NOT_SCANNED);
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
        {/* 고칠 자리는 그 줄의 일부다 — 누르면 줄을 누른 것이라 그 대화가 열린다 (N2). */}
        {spots.length > 0 ? (
          <span className="chat-threads__spots">
            {spots.map((spot, order) => (
              <span
                key={`${spot.kind}-${order}`}
                className={`chat-threads__spot chat-threads__spot--${spot.kind}`}
                title={t(fixSpotHint(spot))}
              >
                {t(fixSpotWords(spot))}
              </span>
            ))}
          </span>
        ) : null}
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
  const scan = useEditor((state) => state.chatFixSpots);
  const missed = useEditor((state) => state.chatFixSpotsMissed);
  const rescan = useEditor((state) => state.retryFixSpotScan);
  const locale = useLocale();
  const failure = useEditor((state) => state.chatThreadsFailure);
  const deleteFailure = useEditor((state) => state.chatThreadDeleteFailure);
  const load = useEditor((state) => state.loadChatThreads);
  const opening = useEditor((state) => state.chatOpening);
  const waiting = useEditor(chatIsWaiting);
  const startOver = useEditor((state) => state.newChatFromThreads);
  const nothingToFix = useEditor(chatNothingToFix);
  const t = useT();
  // 목록 위 한 줄은 훑어 둔 자리 전부에서 나온다 — 파생은 순수 함수의 몫이다.
  const summary = fixSpotSummary(
    Object.values(scan).flatMap((one) => one.spots),
    locale,
  );

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

      {/* 목록은 이어 갈 대화를 보여 주는 자리이지 새 말을 막는 자리가 아니다 (GP-2).
          기다리는 말이 있으면 서지 않는다 — 되묻기 없이 그 말을 버리는 길을 만들지 않는다. */}
      <button
        type="button"
        className="chat-threads__new"
        onClick={startOver}
        disabled={waiting || opening !== null}
        title={
          waiting
            ? t("chat.send.waiting")
            : opening !== null
              ? t("chat.threads.opening.hint")
              : t("chat.new.hint")
        }
      >
        {t("chat.new")}
      </button>

      {/* 무엇부터 보면 좋은지 목록 위에서 먼저 말한다 — 결론이 먼저다(개수·점수 금지). */}
      {summary ? <p className="chat-threads__summary">{summary}</p> : null}

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

      {/* 훑어 본 대화가 모두 조용할 때만 조용하다고 말한다 — 없는 문제도, 없는 성공도 짓지 않는다. */}
      {nothingToFix ? <p className="chat-threads__quiet">{t("chat.fix.none")}</p> : null}

      {/* 지나친 대화가 있으면 그 사실을 말하고 다시 훑을 길을 준다 — 조용한 척하지 않는다 (m5). */}
      {missed ? (
        <>
          <p className="chat-threads__quiet" role="status">
            {t("chat.fix.missed")}
          </p>
          <button
            type="button"
            className="chat-threads__retry"
            onClick={() => void rescan()}
          >
            {t("chat.fix.rescan")}
          </button>
        </>
      ) : null}
    </div>
  );
}
