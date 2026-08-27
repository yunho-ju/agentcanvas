// 문서 카드 아래에 붙는 읽기 전용 판 기록 — 과거 그래프를 열거나 바꾸지 않는다.
import { useEffect, useRef, useState } from "react";
import type { Message } from "../i18n/messages";
import { msg } from "../i18n/messages";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { savedWhen } from "./docWords";
import { shortRevision } from "./revisionWords";

type HistoryState =
  | { phase: "loading" }
  | { phase: "rows"; revisions: readonly { version: number; revision: string; created_at: string }[] }
  | { phase: "empty" }
  | { phase: "failure"; message: Message };

export function RevisionHistory({
  specId,
  onClose,
}: {
  specId: string;
  onClose: () => void;
}) {
  const fetchRevisions = useEditor((state) => state.fetchRevisions);
  const locale = useLocale();
  const t = useT();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HistoryState>({ phase: "loading" });

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void fetchRevisions(specId)
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.revisions === undefined) {
          setState({ phase: "failure", message: outcome.failure });
        } else if (outcome.revisions.length === 0) {
          setState({ phase: "empty" });
        } else {
          setState({ phase: "rows", revisions: outcome.revisions });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "failure", message: msg("revisionHistory.offline") });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, fetchRevisions, specId]);

  return (
    <section className="revision-history layer" aria-labelledby="revision-history-title">
      <div className="revision-history__header">
        <h2 id="revision-history-title" className="revision-history__title">
          {t("revisionHistory.title")}
        </h2>
        <button
          type="button"
          ref={closeButton}
          className="icon-button revision-history__close"
          aria-label={t("revisionHistory.close")}
          title={t("revisionHistory.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {state.phase === "loading" ? (
        <p className="revision-history__status" role="status">
          {t("revisionHistory.loading")}
        </p>
      ) : state.phase === "empty" ? (
        <p className="revision-history__empty">{t("revisionHistory.empty")}</p>
      ) : state.phase === "failure" ? (
        <div className="revision-history__problem" role="alert">
          <span className="revision-history__reason">{t(state.message)}</span>
          <button
            type="button"
            className="revision-history__retry"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("revisionHistory.retry")}
          </button>
        </div>
      ) : (
        <ol className="revision-history__list">
          {state.revisions.map((revision, index) => (
            <li className="revision-history__row" key={`${revision.version}-${index}`}>
              <span className="revision-history__when">
                {t(
                  msg("revisionHistory.version", {
                    version: revision.version,
                    when: savedWhen(revision.created_at, locale),
                  }),
                )}
              </span>
              <code className="revision-history__revision">{shortRevision(revision.revision)}</code>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
