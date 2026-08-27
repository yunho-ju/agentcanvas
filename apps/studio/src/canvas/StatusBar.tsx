// 지금 무엇이 열려 있는지, 저장이 어떻게 됐는지, 편집이 무엇을 함께 바꿨는지를 사람이 읽을 문장으로 보여준다.
// 연결이 왜 안 되는지는 여기서 말하지 않는다 — 그것은 손이 있는 자리에서 말한다 (DESIGN §7).
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { TONE_MARK } from "./toneMark";

export function StatusBar() {
  const feedbackNotice = useEditor((state) => state.feedbackNotice);
  const dismissFeedbackNotice = useEditor((state) => state.dismissFeedbackNotice);
  const notice = useEditor((state) => state.notice);
  const isDraft = useEditor((state) => state.isDraft);
  const dismissNotice = useEditor((state) => state.dismissNotice);
  const t = useT();

  if (!notice && !isDraft && !feedbackNotice) return null;

  return (
    <div className="status-bar">
      {isDraft ? <span className="status-bar__draft">{t("doc.untitled")}</span> : null}
      {feedbackNotice ? (
        <div
          className="status-bar__toast"
          data-tone={feedbackNotice.tone}
          role={feedbackNotice.tone === "danger" ? "alert" : "status"}
        >
          <span className="status-bar__mark" aria-hidden="true">
            {TONE_MARK[feedbackNotice.tone]}
          </span>
          <span className="status-bar__message">{t(feedbackNotice.message)}</span>
          <button
            type="button"
            className="status-bar__dismiss"
            onClick={dismissFeedbackNotice}
          >
            {t("statusBar.ok")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="status-bar__notice" role="status">
          <span className="status-bar__mark" aria-hidden="true">
            {TONE_MARK.ok}
          </span>
          <span className="status-bar__message">{t(notice)}</span>
          <button type="button" className="status-bar__dismiss" onClick={dismissNotice}>
            {t("statusBar.ok")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
