// 서버에 저장해 둔 문서를 고르는 자리 (DESIGN §7 open-dialog).
// 무엇을 물을지·무엇을 열지는 store가 정하고, 여기서는 그것을 보여주고 손과 키를 받는다.
import {
  type KeyboardEvent,
  type MutableRefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { SavedDoc } from "../api/specs";
import { msg } from "../i18n/messages";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { savedWhen } from "./docWords";

/** 목록 안에서 손을 위아래로 옮긴다 — 끝에 닿으면 반대쪽으로 돈다. */
function moveWithin(list: HTMLElement | null, step: number): void {
  const rows = [...(list?.querySelectorAll<HTMLElement>(".open-dialog__doc") ?? [])];
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  rows[(at + step + rows.length) % rows.length]?.focus();
}

function DocRows({
  documents,
  hasMore,
  currentId,
  rowRefs,
  onRowFocus,
  onChoose,
}: {
  documents: SavedDoc[];
  hasMore: boolean;
  currentId: string | null;
  rowRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onRowFocus: (id: string) => void;
  onChoose: (id: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const locale = useLocale();
  const t = useT();

  // 열리면 손은 첫 줄에 놓인다 — 키보드만 쓰는 사람이 목록을 찾아 헤매지 않는다.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(".open-dialog__doc")?.focus();
  }, []);

  if (documents.length === 0) {
    return <p className="open-dialog__empty">{t("open.empty")}</p>;
  }

  return (
    <>
      <ul
        className="open-dialog__list"
        ref={list}
        onKeyDown={(event: KeyboardEvent<HTMLUListElement>) => {
          const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
          if (step === undefined) return;
          event.preventDefault();
          moveWithin(list.current, step);
        }}
      >
        {documents.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              className="open-dialog__doc"
              ref={(row) => {
                if (row) rowRefs.current.set(doc.id, row);
                else rowRefs.current.delete(doc.id);
              }}
              onFocus={() => onRowFocus(doc.id)}
              onClick={() => onChoose(doc.id)}
            >
              <span className="open-dialog__name">{doc.name ?? t("doc.unnamed")}</span>
              <span className="open-dialog__when">
                {t(
                  msg("open.when", {
                    when: savedWhen(doc.saved_at, locale),
                    version: doc.version,
                  }),
                )}
              </span>
              {doc.id === currentId ? (
                <span className="open-dialog__badge">{t("open.current")}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {/* 뒤에 더 있다고 서버가 말했으면 그 사실을 전한다 — 조용히 자르지 않는다. */}
      {hasMore ? (
        <p className="open-dialog__truncated">{t("open.truncated")}</p>
      ) : null}
    </>
  );
}

function AskBeforeOpening({ id }: { id: string }) {
  const openDocAnyway = useEditor((state) => state.openDocAnyway);
  const saveThenOpenDoc = useEditor((state) => state.saveThenOpenDoc);
  const cancelOpening = useEditor((state) => state.cancelOpening);
  const first = useRef<HTMLButtonElement>(null);
  const t = useT();

  // 되묻는 물음에는 손이 답 위에 놓인 채로 시작한다.
  useEffect(() => first.current?.focus(), []);

  return (
    <div className="open-dialog__ask">
      <p className="open-dialog__ask-body">{t("open.ask")}</p>
      <div className="open-dialog__actions">
        <button
          type="button"
          ref={first}
          className="open-dialog__button open-dialog__save"
          onClick={() => void saveThenOpenDoc(id)}
        >
          {t("open.ask.save")}
        </button>
        <button
          type="button"
          className="open-dialog__button open-dialog__anyway"
          title={t("open.ask.anyway.hint")}
          onClick={() => void openDocAnyway(id)}
        >
          {t("open.ask.anyway")}
        </button>
        <button
          type="button"
          className="open-dialog__button open-dialog__back"
          onClick={cancelOpening}
        >
          {t("open.ask.back")}
        </button>
      </div>
    </div>
  );
}

function FileAskBeforeOpening() {
  const openFileAnyway = useEditor((state) => state.openFileAnyway);
  const saveThenOpenFile = useEditor((state) => state.saveThenOpenFile);
  const cancelFileOpen = useEditor((state) => state.cancelFileOpen);
  const first = useRef<HTMLButtonElement>(null);
  const t = useT();

  // 되묻는 물음에는 손이 답 위에 놓인 채로 시작한다.
  useEffect(() => first.current?.focus(), []);

  return (
    <div className="open-dialog__ask">
      <p className="open-dialog__ask-body">{t("open.ask")}</p>
      <div className="open-dialog__actions">
        <button
          type="button"
          ref={first}
          className="open-dialog__button open-dialog__save"
          onClick={() => void saveThenOpenFile()}
        >
          {t("open.ask.save")}
        </button>
        <button
          type="button"
          className="open-dialog__button open-dialog__anyway"
          title={t("open.ask.anyway.hint")}
          onClick={openFileAnyway}
        >
          {t("open.ask.anyway")}
        </button>
        <button
          type="button"
          className="open-dialog__button open-dialog__back"
          onClick={cancelFileOpen}
        >
          {t("open.ask.back")}
        </button>
      </div>
    </div>
  );
}

function ListFailure({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const t = useT();

  return (
    <div className="open-dialog__problem" role="alert">
      <span className="open-dialog__mark" aria-hidden="true">
        ✕
      </span>
      <span className="open-dialog__reason">{reason}</span>
      <button
        type="button"
        className="open-dialog__button open-dialog__retry"
        onClick={onRetry}
      >
        {t("open.retry")}
      </button>
    </div>
  );
}

export function OpenDialog() {
  const docList = useEditor((state) => state.docList);
  const pendingFile = useEditor((state) => state.pendingFile);
  const currentId = useEditor((state) => state.spec?.id ?? null);
  const chooseDoc = useEditor((state) => state.chooseDoc);
  const reloadDocList = useEditor((state) => state.reloadDocList);
  const closeDocList = useEditor((state) => state.closeDocList);
  const cancelFileOpen = useEditor((state) => state.cancelFileOpen);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastFocusedRow = useRef<string | null>(null);
  const previousLoading = useRef(false);
  const focusHandoff = useRef<
    { kind: "refresh"; rowId: string | null; hadRows: boolean } | { kind: "retry" } | null
  >(null);
  const t = useT();

  function focusFirstRowOrClose(): void {
    const first = dialogRef.current?.querySelector<HTMLElement>(".open-dialog__doc");
    (first ?? closeRef.current)?.focus();
  }

  function focusResult(rowId: string | null): void {
    const row = rowId === null ? null : rowRefs.current.get(rowId);
    const first = dialogRef.current?.querySelector<HTMLElement>(".open-dialog__doc");
    (row ?? first ?? closeRef.current)?.focus();
  }

  function hasMeaningfulFocusOutsideDialog(): boolean {
    const active = document.activeElement;
    const dialog = dialogRef.current;
    return Boolean(
      active &&
        active !== document.body &&
        active !== document.documentElement &&
        dialog &&
        !dialog.contains(active),
    );
  }

  function startRefresh(): void {
    const hadRows = (docList?.documents?.length ?? 0) > 0;
    focusHandoff.current = {
      kind: "refresh",
      rowId: hadRows ? lastFocusedRow.current : null,
      hadRows,
    };
    void reloadDocList();
  }

  function startRetry(): void {
    focusHandoff.current = { kind: "retry" };
    void reloadDocList();
  }

  function rememberRowFocus(id: string): void {
    lastFocusedRow.current = id;
    if (focusHandoff.current?.kind === "refresh") {
      focusHandoff.current.rowId = id;
    }
  }

  function chooseRow(id: string): void {
    // 문서 GET으로 넘어가면 새로고침의 실패 초점 목적지는 더 이상 유효하지 않다.
    focusHandoff.current = null;
    void chooseDoc(id);
  }

  useLayoutEffect(() => {
    const current = docList;
    const handoff = focusHandoff.current;
    if (current === null) {
      previousLoading.current = false;
      focusHandoff.current = null;
      return;
    }
    if (current.asking !== null) {
      previousLoading.current = current.loading;
      focusHandoff.current = null;
      return;
    }
    if (handoff !== null) {
      if (current.loading) {
        if (!previousLoading.current) {
          if (handoff.kind === "retry") closeRef.current?.focus();
          else focusFirstRowOrClose();
        }
      } else {
        if (current.failure) {
          dialogRef.current?.querySelector<HTMLElement>(".open-dialog__retry")?.focus();
        } else {
          const preserveFocus =
            handoff.kind === "refresh" &&
            (hasMeaningfulFocusOutsideDialog() ||
              (handoff.hadRows && document.activeElement === closeRef.current));
          if (!preserveFocus) {
            focusResult(handoff.kind === "refresh" ? handoff.rowId : null);
          }
        }
        focusHandoff.current = null;
      }
    }
    previousLoading.current = current.loading;
  }, [docList]);

  if (pendingFile !== null) {
    return (
      <section
        className="open-dialog layer"
        role="alertdialog"
        aria-label={t("open.fileAsk.title")}
      >
        <header className="open-dialog__header">
          <h2 className="open-dialog__title">{t("open.fileAsk.title")}</h2>
          <button
            type="button"
            className="icon-button open-dialog__close"
            title={t("open.close")}
            aria-label={t("open.close")}
            onClick={cancelFileOpen}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <FileAskBeforeOpening />
      </section>
    );
  }

  if (docList === null) return null;
  const { documents, failure, asking, loading } = docList;

  return (
    <section
      className="open-dialog layer"
      role="dialog"
      aria-label={t("open.title")}
      aria-busy={loading}
      ref={dialogRef}
    >
      <header className="open-dialog__header">
        <div className="open-dialog__heading">
          <h2 className="open-dialog__title">{t("open.title")}</h2>
          {documents !== null && !failure && asking === null ? (
            <button
              type="button"
              className="icon-button open-dialog__reload"
              title={t("open.reload")}
              aria-label={t("open.reload")}
              disabled={loading}
              onClick={startRefresh}
            >
              <span aria-hidden="true">↻</span>
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="icon-button open-dialog__close"
          title={t("open.close")}
          aria-label={t("open.close")}
          ref={closeRef}
          onClick={closeDocList}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {loading ? (
        <p className="open-dialog__status" role="status">
          {t("open.loading")}
        </p>
      ) : null}
      {failure ? <ListFailure reason={t(failure)} onRetry={startRetry} /> : null}
      {/* 되묻는 동안에는 목록 대신 물음이 같은 카드를 쓴다 — 새 레이어를 띄우지 않는다. */}
      {asking !== null ? (
        <AskBeforeOpening id={asking} />
      ) : documents ? (
        <DocRows
          documents={documents}
          hasMore={docList.hasMore}
          currentId={currentId}
          rowRefs={rowRefs}
          onRowFocus={rememberRowFocus}
          onChoose={chooseRow}
        />
      ) : null}
    </section>
  );
}
