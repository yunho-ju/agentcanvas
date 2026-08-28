// 붙여 넣으면 도구가 된다 (DESIGN §7 tool-wrap-card).
// 한 시점에 하나만 묻는다: 무엇을 붙여 넣었나 -> 이 연결을 넣을까. 승인 전에는 문서가 그대로다.
import { useEffect, useRef } from "react";
import type { ToolSourceKind } from "../api/toolWrap";
import type { ResourceBinding } from "../generated/agent_spec";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useDocResources } from "../inspector/useDocResources";
import { useEditor } from "../store/editor";
import { ToolLines } from "./ToolList";
import { needsASecret, newConnections } from "./resourceWords";

/** 붙여 넣을 수 있는 것 — 서버의 표와 같은 이름이고, 새 종류는 여기 한 줄이다. */
const SOURCE_KINDS: { kind: ToolSourceKind; name: MessageKey }[] = [
  { kind: "openapi", name: "toolWrap.kind.openapi" },
  { kind: "curl", name: "toolWrap.kind.curl" },
  { kind: "prose", name: "toolWrap.kind.prose" },
];

function ProposedConnection({ binding }: { binding: ResourceBinding }) {
  const t = useT();

  return (
    <li className="tool-wrap-card__connection">
      <span className="tool-wrap-card__label">{t("toolWrap.review.name")}</span>
      <span className="tool-wrap-card__name">{binding.id}</span>
      <ul className="tool-wrap-card__tools">
        {(binding.tools ?? []).map((tool) => (
          <li className="tool-wrap-card__tool" key={tool.name}>
            <ToolLines tool={tool} />
          </li>
        ))}
      </ul>
      {/* 비밀은 이름만 온다 — 값이 어디에 있는지 그 자리에서 말한다. */}
      {needsASecret(binding) ? (
        <span className="tool-wrap-card__secret">{t("toolWrap.secret")}</span>
      ) : null}
    </li>
  );
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

function Reviewing({ proposed }: { proposed: ResourceBinding[] }) {
  const apply = useEditor((state) => state.applyToolWrap);
  const rewrite = useEditor((state) => state.rewriteToolWrap);
  const error = useEditor((state) => state.toolWrapError);
  const t = useT();
  // 넣을 것이 없는 제안을 말없이 되돌리지 않는다 — 무슨 일이 있었는지 말하고 다음 걸음을 준다.
  const nothingNew = proposed.length === 0;

  return (
    <>
      <ul className="tool-wrap-card__proposed">
        {proposed.map((binding) => (
          <ProposedConnection binding={binding} key={binding.id} />
        ))}
      </ul>
      {nothingNew ? (
        <p className="tool-wrap-card__error" role="alert">
          {t("toolWrap.error.nothingNew")}
        </p>
      ) : error ? (
        <p className="tool-wrap-card__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="tool-wrap-card__actions">
        {nothingNew ? null : (
          <button
            type="button"
            className="button-primary"
            title={t("toolWrap.apply.hint")}
            onClick={apply}
          >
            {t("toolWrap.apply")}
          </button>
        )}
        <button
          type="button"
          className="button-ghost"
          title={t("toolWrap.back.hint")}
          onClick={rewrite}
        >
          {t("toolWrap.back")}
        </button>
      </div>
    </>
  );
}

export function ToolWrapCard() {
  const mode = useEditor((state) => state.toolWrapMode);
  const candidate = useEditor((state) => state.toolWrapCandidate);
  const { bindings } = useDocResources();
  const t = useT();

  // 카드가 물러나면 손은 이 카드를 부른 버튼으로 돌아간다 (open-dialog와 같은 규칙).
  useEffect(() => {
    if (mode !== "closed") return;
    document.querySelector<HTMLElement>(".resources-panel__new")?.focus();
  }, [mode]);

  if (mode === "closed") return null;
  const proposed = candidate
    ? newConnections(candidate.resources ?? [], bindings)
    : [];
  const reviewing = mode === "review";
  const title = reviewing ? "toolWrap.review.title" : "toolWrap.title";

  return (
    <section className="tool-wrap-card layer" role="dialog" aria-label={t(title)}>
      <h2 className="tool-wrap-card__title">{t(title)}</h2>
      {reviewing ? <Reviewing proposed={proposed} /> : <Asking />}
    </section>
  );
}
