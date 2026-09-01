// 대화 — 내놓은 판에 말을 걸고 답을 받는 자리 (DESIGN §7 chat-panel).
// 캔버스는 배경에 그대로다: 이 패널은 우측 스택에 서고, 한 시점에 오가는 말은 하나다.
// 이 자리는 두 뷰 가운데 무엇을 세울지만 정한다 — '지금 대화'와 '지난 대화'는 각자 그린다.
import { useT } from "../i18n/useT";
import { chatSpecOf } from "../store/chatSlice";
import { useEditor } from "../store/editor";
import { ChatNowView } from "./ChatNowView";
import { ChatThreadList } from "./ChatThreadList";
import { chatPinWords } from "./chatPin";

export function ChatPanel() {
  const open = useEditor((state) => state.chatOpen);
  const spec = useEditor(chatSpecOf);
  const pin = useEditor((state) => state.chatPin);
  const past = useEditor((state) => state.chatView === "past");
  const showPast = useEditor((state) => state.showPastChats);
  const showNow = useEditor((state) => state.showNowChat);
  const t = useT();

  // 말을 걸 판이 없으면 서지 않는다 — 빈 카드를 띄우지 않는다.
  if (!open || spec === null) return null;

  return (
    <section className="chat-panel layer" aria-label={t("chat.title")}>
      <header className="chat-panel__header">
        <h2 className="chat-panel__title">{t("chat.title")}</h2>
        {/* 어느 판과 이야기하는지는 대화가 붙잡은 그 판이 말한다 — 캔버스가 바뀌어도 그대로다.
            목록은 어느 한 판의 이야기가 아니므로 이 줄은 '지금 대화'에서만 선다. */}
        {pin && !past ? <p className="chat-panel__pin">{t(chatPinWords(pin))}</p> : null}
        {/* 지난 대화로 가는 길은 언제나 같은 자리에 있다 — 새 모드를 만들지 않는다 (결정 1). */}
        <button
          type="button"
          className="chat-panel__past"
          onClick={past ? showNow : showPast}
          title={past ? t("chat.threads.now.hint") : t("chat.threads.hint")}
        >
          {t(past ? "chat.threads.now" : "chat.threads")}
        </button>
      </header>

      {past ? <ChatThreadList /> : <ChatNowView spec={spec} />}
    </section>
  );
}
