// 지금 무엇이 열려 있는지, 저장이 어떻게 됐는지, 편집이 무엇을 함께 바꿨는지를 사람이 읽을 문장으로 보여준다.
// 연결이 왜 안 되는지는 여기서 말하지 않는다 — 그것은 손이 있는 자리에서 말한다 (DESIGN §7).
import { useT } from "../i18n/useT";
import { useFocusInspector } from "../inspector/inspectorFocus";
import { useEditor } from "../store/editor";
import { TONE_MARK } from "./toneMark";

export function StatusBar() {
  const feedbackNotice = useEditor((state) => state.feedbackNotice);
  const dismissFeedbackNotice = useEditor((state) => state.dismissFeedbackNotice);
  const notice = useEditor((state) => state.notice);
  const isDraft = useEditor((state) => state.isDraft);
  const dismissNotice = useEditor((state) => state.dismissNotice);
  const select = useEditor((state) => state.select);
  const focusInspector = useFocusInspector();
  const t = useT();
  const where = feedbackNotice?.where ?? null;
  // 소식은 저장하던 순간의 이야기다 — 그 카드가 아직 있는지는 지금 그래프에게 묻는다.
  const cardIsThere = useEditor((state) =>
    state.nodes.some((node) => node.id === where?.nodeId),
  );

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
          {/* 어디를 고칠지 말했으면 그리로 데려간다 — 실행 옆 '!' 알약과 같은 행동이다. */}
          {where && cardIsThere ? (
            <button
              type="button"
              className="status-bar__go"
              onClick={() => {
                select("node", where.nodeId);
                focusInspector();
                dismissFeedbackNotice();
              }}
            >
              {t("save.issue.go")}
            </button>
          ) : null}
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
