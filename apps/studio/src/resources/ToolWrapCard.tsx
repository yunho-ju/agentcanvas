// 붙여 넣으면 도구가 된다 (DESIGN §7 tool-wrap-card).
// 한 시점에 하나만 묻는다: 무엇을 붙여 넣었나 -> 이 연결을 넣을까. 승인 전에는 문서가 그대로다.
import { useEffect, useRef } from "react";
import type { ToolSourceKind } from "../api/toolWrap";
import { newConnections } from "../graph/connections";
import { type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useDocResources } from "../inspector/useDocResources";
import { useEditor } from "../store/editor";
import { Reviewing, ReviewingSwap } from "./ToolWrapReview";

/** 붙여 넣을 수 있는 것 — 서버의 표와 같은 이름이고, 새 종류는 여기 한 줄이다. */
const SOURCE_KINDS: { kind: ToolSourceKind; name: MessageKey }[] = [
  { kind: "openapi", name: "toolWrap.kind.openapi" },
  { kind: "curl", name: "toolWrap.kind.curl" },
  { kind: "prose", name: "toolWrap.kind.prose" },
];

/** 그 연결 줄의 다시 가져오기 버튼 — 카드를 부른 자리다. */
function rowOf(id: string): HTMLElement | null {
  // 연결 이름은 사람이 지은 글자다 — 선택자에 그대로 끼워 넣지 않고 읽어서 견준다.
  const rows = [...document.querySelectorAll(".resources-panel__connection")];
  const row = rows.find((one) => one.getAttribute("aria-label") === id);
  return row?.querySelector<HTMLElement>(".resources-panel__reimport") ?? null;
}

function Asking() {
  const kind = useEditor((state) => state.toolWrapKind);
  const source = useEditor((state) => state.toolWrapSource);
  const error = useEditor((state) => state.toolWrapError);
  const loading = useEditor((state) => state.toolWrapLoading);
  const setKind = useEditor((state) => state.setToolWrapKind);
  const setSource = useEditor((state) => state.setToolWrapSource);
  const build = useEditor((state) => state.buildToolWrap);
  const close = useEditor((state) => state.closeToolWrap);
  const box = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  // 열리면 손은 붙여 넣을 자리에 놓인다.
  useEffect(() => box.current?.focus(), []);

  return (
    <>
      <p className="tool-wrap-card__description">{t("toolWrap.description")}</p>
      <div
        className="tool-wrap-card__kinds"
        role="group"
        aria-label={t("toolWrap.kind.label")}
      >
        {SOURCE_KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className="tool-wrap-card__kind"
            aria-pressed={option.kind === kind}
            disabled={loading}
            onClick={() => setKind(option.kind)}
          >
            {t(option.name)}
          </button>
        ))}
      </div>
      <label className="tool-wrap-card__label" htmlFor="tool-wrap-source">
        {t("toolWrap.source.label")}
      </label>
      <textarea
        id="tool-wrap-source"
        ref={box}
        className="control tool-wrap-card__source"
        value={source}
        disabled={loading}
        placeholder={t("toolWrap.source.placeholder")}
        aria-describedby={error ? "tool-wrap-error" : undefined}
        onChange={(event) => setSource(event.target.value)}
      />
      {loading ? (
        <p className="tool-wrap-card__status" role="status">
          {t("toolWrap.loading")}
        </p>
      ) : null}
      {error ? (
        <p id="tool-wrap-error" className="tool-wrap-card__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="tool-wrap-card__actions">
        <button
          type="button"
          className="button-primary"
          disabled={source.trim() === "" || loading}
          title={
            source.trim() === "" ? t("toolWrap.build.disabled") : t("toolWrap.build.hint")
          }
          onClick={() => void build()}
        >
          {t("toolWrap.build")}
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={loading}
          title={t("toolWrap.cancel.hint")}
          onClick={close}
        >
          {t("toolWrap.cancel")}
        </button>
      </div>
    </>
  );
}

export function ToolWrapCard() {
  const mode = useEditor((state) => state.toolWrapMode);
  const candidate = useEditor((state) => state.toolWrapCandidate);
  const replacing = useEditor((state) => state.toolWrapReplacing);
  const { bindings } = useDocResources();
  const t = useT();

  // 카드가 물러나면 손은 이 카드를 부른 버튼으로 돌아간다 (open-dialog와 같은 규칙).
  // 부른 자리는 둘이다 — 새 연결 버튼, 또는 그 연결 줄의 다시 가져오기 버튼.
  const opener = useRef<string | null>(null);
  if (mode !== "closed") opener.current = replacing;
  useEffect(() => {
    if (mode !== "closed") return;
    const called = opener.current;
    const row = called === null ? null : rowOf(called);
    (row ?? document.querySelector<HTMLElement>(".resources-panel__new"))?.focus();
    opener.current = null;
  }, [mode]);

  if (mode === "closed") return null;
  const proposed = candidate ? newConnections(candidate.resources ?? [], bindings) : [];
  const reviewing = mode === "review";
  // 다시 가져오는 중에는 제목이 대상 연결의 이름을 말한다 — 무엇을 고치는 중인지 잊지 않는다.
  const heading = replacing
    ? msg("toolWrap.reimport.title", { id: replacing })
    : msg(reviewing ? "toolWrap.review.title" : "toolWrap.title");
  const before = bindings.find((binding) => binding.id === replacing);
  const after = (candidate?.resources ?? []).find(
    (binding) => binding.id === replacing,
  );

  return (
    <section className="tool-wrap-card layer" role="dialog" aria-label={t(heading)}>
      <h2 className="tool-wrap-card__title">{t(heading)}</h2>
      {!reviewing ? (
        <Asking />
      ) : replacing && before ? (
        <ReviewingSwap before={before} after={after} />
      ) : (
        <Reviewing proposed={proposed} />
      )}
    </section>
  );
}
