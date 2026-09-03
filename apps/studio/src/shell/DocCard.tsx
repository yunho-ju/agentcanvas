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
import { type HistoryCommand, useHistoryCommands } from "./historyCommands";
import { HISTORY_IN_MENU, useWidthMatch } from "./topLayout";
import { useSignOut } from "./signOut";

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
  // 이 카드 위에 무엇이 떠 있는지는 store가 안다 — Esc 체인이 볼 수 있어야 하기 때문이다
  // (DESIGN §1 팝오버 예외, §7 doc-card).
  const docPopover = useEditor((state) => state.docPopover);
  const toggleDocMenu = useEditor((state) => state.toggleDocMenu);
  const openRevisionHistory = useEditor((state) => state.openRevisionHistory);
  const closeDocPopover = useEditor((state) => state.closeDocPopover);
  const open = docPopover === "menu";
  const [renaming, setRenaming] = useState(false);
  const [problems, setProblems] = useState<Message[]>([]);
  const field = useRef<HTMLInputElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const wasListing = useRef(false);
  const wasFileAsking = useRef(false);
  const wasPopoverOpen = useRef(false);
  const ranHistory = useRef<HistoryCommand["id"] | null>(null);
  // 좁은 화면에서 상단의 되돌리기 줄이 이 메뉴로 들어온다 (DESIGN §1 상단 레이어 900↓).
  const history = useHistoryCommands();
  const historyInMenu = useWidthMatch(HISTORY_IN_MENU);
  // 이 자리를 떠나는 길 — 세션 껍데기가 있을 때만 있다 (DESIGN §7 doc-card 로그아웃).
  const signOut = useSignOut();
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

  // 팝오버가 어떤 길로 닫혔든(항목 선택·재클릭·Esc) 손은 문서 메뉴 버튼으로 돌아온다
  // — 열린 자리를 잃지 않는다 (DESIGN §7 doc-card).
  useEffect(() => {
    const popoverOpen = docPopover !== "closed";
    if (wasPopoverOpen.current && !popoverOpen) menuButton.current?.focus();
    wasPopoverOpen.current = popoverOpen;
  }, [docPopover]);

  // 되돌리기를 눌러 되돌릴 것이 다 떨어지면 그 항목은 잠긴다 — 잠긴 자리에 손을 두고 오지
  // 않는다. 남은 것이 있으면 잇따라 누를 수 있게 그 자리에 그대로 둔다.
  useEffect(() => {
    const ran = ranHistory.current;
    if (ran === null) return;
    ranHistory.current = null;
    if (history.find((command) => command.id === ran)?.disabled) {
      menuButton.current?.focus();
    }
  }, [history]);

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
    closeDocPopover();
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
    closeDocPopover();
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
            onClick={toggleDocMenu}
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
          {/* 좁은 화면에서는 상단의 되돌리기 줄이 이 메뉴의 첫 두 항목으로 들어온다
              (DESIGN §1 상단 레이어 900↓) — 같은 명령, 같은 비활성 이유다.
              되돌리기는 잇따라 누르는 일이라 메뉴를 닫지 않는다. */}
          {historyInMenu
            ? history.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  className={`doc-menu__${command.id}`}
                  onClick={() => {
                    ranHistory.current = command.id;
                    command.run();
                  }}
                  disabled={command.disabled}
                  title={t(command.hint)}
                >
                  {t(command.name)}
                </button>
              ))
            : null}
          <button
            type="button"
            className="doc-menu__save"
            onClick={() => {
              void saveSpec();
              closeDocPopover();
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
              closeDocPopover();
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
            onClick={openRevisionHistory}
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
                  closeDocPopover();
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
                  closeDocPopover();
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
                closeDocPopover();
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
              closeDocPopover();
            }}
            disabled={spec === null || running}
            title={t("doc.arrange.hint")}
          >
            {t("doc.arrange")}
          </button>
          {/* 문서의 일이 아니라 이 자리를 떠나는 일이라 구분선 뒤 마지막에 선다
              (DESIGN §7 doc-card 로그아웃). 세션을 모르는 화면에는 아예 없다. */}
          {signOut ? (
            <button
              type="button"
              className="doc-menu__logout"
              onClick={() => {
                signOut();
                closeDocPopover();
              }}
              title={t("auth.logout.hint")}
            >
              {t("auth.logout")}
            </button>
          ) : null}
        </div>
      ) : null}
      {docPopover === "history" && spec !== null ? (
        <RevisionHistory specId={spec.id} onClose={closeDocPopover} />
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
