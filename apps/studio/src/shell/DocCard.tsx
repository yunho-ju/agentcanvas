// 좌상단 문서 카드 — 무엇을 열어 두고 있는지, 어디까지 저장했는지, 파일을 다루는 길.
// 파일 다루기는 자주 쓰는 일이 아니라 이름 뒤의 메뉴에 접어 둔다 (캔버스가 화면의 주인이다).
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { downloadSpec, parseSpec } from "../graph/file";
import { validateSpec } from "../graph/validateSpec";
import { type Message, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { docListIsOpen, fileOpenIsAsking } from "../store/openSlice";
import { isRunning } from "../store/runSlice";
import { captionFor, savedVersion, unsavedChanges } from "../store/saveSlice";
import { LocaleToggle } from "../i18n/LocaleToggle";
import { ThemeToggle } from "../theme/ThemeToggle";
import { RevisionHistory } from "./RevisionHistory";

export function DocCard() {
  const spec = useEditor((state) => state.spec);
  const exportSpec = useEditor((state) => state.exportSpec);
  const arrangeNodes = useEditor((state) => state.arrangeNodes);
  const renameSpec = useEditor((state) => state.renameSpec);
  const saveSpec = useEditor((state) => state.saveSpec);
  const saving = useEditor((state) => state.saving);
  const version = useEditor(savedVersion);
  const changed = useEditor(unsavedChanges);
  const caption = captionFor(saving, version, changed);
  const running = useEditor(isRunning);
  const savedSpec = useEditor((state) => state.savedSpec);
  const publication = useEditor((state) => state.publication);
  const publishedVersion = useEditor((state) => state.publishedVersion);
  const publishCurrent = useEditor((state) => state.publishCurrent);
  const unpublishCurrent = useEditor((state) => state.unpublishCurrent);
  // 이 문서가 지금 게시돼 있는가 — 게시 pointer가 지금 연 저장본을 가리킬 때만.
  const published =
    publication !== null &&
    savedSpec !== null &&
    publication.spec_id === savedSpec.id;
  // 게시된 판이 지금 보는(저장된) 판과 같은가 — 다르면 만드는 쪽이 캔버스를 고쳐 저장한 것이다.
  const publishedIsCurrent =
    published && publication?.revision === savedSpec?.revision;
  const showDocList = useEditor((state) => state.showDocList);
  const requestFileOpen = useEditor((state) => state.requestFileOpen);
  const listing = useEditor(docListIsOpen);
  const fileAsking = useEditor(fileOpenIsAsking);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [problems, setProblems] = useState<Message[]>([]);
  const field = useRef<HTMLInputElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const wasListing = useRef(false);
  const wasFileAsking = useRef(false);
  const wasHistoryOpen = useRef(false);
  const t = useT();

  // 목록을 닫으면 손은 목록을 연 자리(문서 메뉴 버튼)로 돌아온다 — 초점이 허공에 떨어지면
  // 그다음 키가 앱에 닿지 않는다.
  useEffect(() => {
    if (wasListing.current && !listing) menuButton.current?.focus();
    wasListing.current = listing;
  }, [listing]);

  // 파일을 열지 않기로 하면 손은 파일을 고른 자리(문서 메뉴 버튼)로 돌아온다.
  useEffect(() => {
    if (wasFileAsking.current && !fileAsking) menuButton.current?.focus();
    wasFileAsking.current = fileAsking;
  }, [fileAsking]);

  // 판 기록을 닫으면 손은 문서 메뉴 버튼으로 돌아온다 — 열린 자리를 잃지 않는다.
  useEffect(() => {
    if (wasHistoryOpen.current && !historyOpen) menuButton.current?.focus();
    wasHistoryOpen.current = historyOpen;
  }, [historyOpen]);

  // 고치기를 끝내면 손은 시작한 자리(문서명)로 돌아온다 — 초점이 허공에 떨어지면
  // 그다음 키가 앱에 닿지 않고, 키보드만 쓰는 사람은 자리를 잃는다.
  useEffect(() => {
    if (wasRenaming.current && !renaming) nameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  // 문서를 부르는 이름 — 아직 이름을 짓지 않았으면 쉬운 말로 부른다.
  // 그래프의 id는 내부 이름표다: 화면에 쓰지 않는다 (열기 목록도 같은 말로 부른다).
  // 아직 아무 문서도 없으면 '새 초안', 문서는 있는데 이름만 없으면 '이름 없는 문서'
  // — 뒤엣말은 열기 목록이 쓰는 말과 같다(한 문서를 두 화면이 다르게 부르지 않는다).
  const title = spec === null ? t("doc.untitled") : (spec.name ?? t("doc.unnamed"));

  async function onOpen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = parseSpec(await file.text());
    if (result.errors) {
      setProblems(result.errors);
      return;
    }
    setProblems([]);
    requestFileOpen(result.spec);
    setOpen(false);
  }

  function onExport() {
    const candidate = exportSpec();
    // 내보내기 전에 committed schema로 한 번 더 검증한다 — 계약 밖 JSON은 내보내지 않는다.
    const errors = validateSpec(candidate);
    if (errors.length > 0) {
      setProblems(errors.map((problem) => msg("doc.specProblem", { problem })));
      return;
    }
    setProblems([]);
    downloadSpec(candidate, `${candidate.id}.json`);
    setOpen(false);
  }

  function keepTheName() {
    renameSpec(field.current?.value ?? "");
    setRenaming(false);
  }

  // 이름을 고치는 동안 Esc는 이 칸의 것이다 — 화면의 물러나는 순서는 글자를 치는 중에 물러선다.
  // 저장(Cmd+S)은 이 칸에서도 듣는다: 고치던 이름을 먼저 확정하고 저장으로 넘긴다.
  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // 이 Enter는 "확정"이라는 뜻뿐이다 — 손이 돌아간 문서명 버튼을 잇따라 누르지 않게 막는다.
      event.preventDefault();
      keepTheName();
    }
    if (event.key === "Escape") setRenaming(false);
    if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
      keepTheName();
    }
  }

  return (
    <div className="doc-card layer">
      <span className="doc-card__logo" aria-hidden="true">
        ◈
      </span>
      <span className="doc-card__brand">AgentCanvas</span>
      <div className="doc-card__doc-column">
        <div className="doc-card__title-row">
          {renaming ? (
            <input
              ref={field}
              type="text"
              className="doc-card__rename control"
              aria-label={t("doc.rename.field")}
              title={t("doc.rename.hint")}
              // 아직 이름이 없으면 칸도 비어 있다 — 화면이 붙인 말을 이름으로 굳히지 않는다.
              defaultValue={spec?.name ?? ""}
              autoFocus
              onKeyDown={onRenameKey}
              onBlur={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              ref={nameButton}
              className="doc-card__name"
              aria-label={t("doc.rename", { name: title })}
              title={t("doc.rename.hint")}
              onClick={() => setRenaming(true)}
              disabled={spec === null}
            >
              <span className="doc-card__doc">{title}</span>
            </button>
          )}
          <button
            type="button"
            ref={menuButton}
            className="doc-card__menu-toggle"
            aria-expanded={open}
            title={t("doc.menu.hint")}
            aria-label={t("doc.menu.label", { name: title })}
            onClick={() => {
              setHistoryOpen(false);
              setOpen(!open);
            }}
          >
            <span className="doc-card__caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
        {/* 어디까지 저장했는지는 늘 보인다 — 물어봐야 알 수 있는 것이 아니다. */}
        <span className="doc-card__saved">{t(caption)}</span>
        {/* 게시 표식은 저장 캡션과 다른 축이라 별도 한 줄 — 게시됐을 때만 보인다.
            게시된 판이 지금 보는 판과 다르면, 만드는 쪽이 캔버스를 고쳐도 게시는 그대로임을 말한다. */}
        {published ? (
          <span className="doc-card__published">
            {publishedIsCurrent
              ? t(msg("publish.mark.same"))
              : t(msg("publish.mark.different", { version: publishedVersion ?? 0 }))}
          </span>
        ) : null}
      </div>
      <ThemeToggle />
      <LocaleToggle />
      {open ? (
        <div className="doc-menu layer">
          <button
            type="button"
            className="doc-menu__save"
            onClick={() => {
              void saveSpec();
              setOpen(false);
            }}
            disabled={spec === null || saving}
            title={
              spec === null
                ? t("save.none")
                : saving
                  ? t("save.caption.saving")
                  : t("save.hint")
            }
          >
            {t("save.action")}
          </button>
          {/* 두 '열기'는 이름으로 구분한다 — 서버에 둔 것은 '열기', 내 컴퓨터의 것은 '파일 열기'. */}
          <button
            type="button"
            className="doc-menu__open-server"
            onClick={() => {
              void showDocList();
              setOpen(false);
            }}
            title={t("open.action.hint")}
          >
            {t("open.action")}
          </button>
          <button
            type="button"
            className="doc-menu__open-server"
            disabled={spec === null}
            title={spec === null ? t("revisionHistory.none") : t("revisionHistory.action")}
            onClick={() => {
              setHistoryOpen(true);
              setOpen(false);
            }}
          >
            {t("revisionHistory.action")}
          </button>
          {/* 게시 — 저장된 판을 대화 상대로 내놓는다. 저장 안 된 변경이 있으면 막고 이유를 말한다
              (게시는 저장된 판을 가리키는 일). 이미 게시됐으면 갱신·내리기 두 갈래로 나뉜다. */}
          {published ? (
            <>
              <button
                type="button"
                className="doc-menu__publish"
                disabled={changed}
                title={changed ? t("publish.disabled.unsaved") : t("publish.replace.hint")}
                onClick={() => {
                  void publishCurrent();
                  setOpen(false);
                }}
              >
                {t("publish.replace")}
              </button>
              <button
                type="button"
                className="doc-menu__unpublish"
                title={t("publish.down.hint")}
                onClick={() => {
                  void unpublishCurrent();
                  setOpen(false);
                }}
              >
                {t("publish.down")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="doc-menu__publish"
              disabled={spec === null || changed}
              title={
                spec === null
                  ? t("publish.disabled.none")
                  : changed
                    ? t("publish.disabled.unsaved")
                    : t("publish.action.hint")
              }
              onClick={() => {
                void publishCurrent();
                setOpen(false);
              }}
            >
              {t("publish.action")}
            </button>
          )}
          {/* 이 라벨의 글은 파일 입력의 이름이기도 하다 — 기호를 섞지 않는다. */}
          <label className="doc-menu__open" htmlFor="open-spec">
            {t("doc.open")}
          </label>
          <input
            id="open-spec"
            className="doc-menu__file"
            type="file"
            accept="application/json,.json"
            onChange={onOpen}
          />
          <button
            type="button"
            className="doc-menu__export"
            onClick={onExport}
            disabled={spec === null}
            title={spec === null ? t("doc.export.none") : t("doc.export.hint")}
          >
            {t("doc.export")}
          </button>
          <button
            type="button"
            className="doc-menu__arrange"
            onClick={() => {
              arrangeNodes();
              setOpen(false);
            }}
            disabled={spec === null || running}
            title={t("doc.arrange.hint")}
          >
            {t("doc.arrange")}
          </button>
        </div>
      ) : null}
      {historyOpen && spec !== null ? (
        <RevisionHistory specId={spec.id} onClose={() => setHistoryOpen(false)} />
      ) : null}
      {problems.length > 0 ? (
        <p role="alert" className="doc-card__problems">
          <span aria-hidden="true">!</span>{" "}
          {problems.map((problem) => t(problem)).join(" / ")}
        </p>
      ) : null}
    </div>
  );
}
