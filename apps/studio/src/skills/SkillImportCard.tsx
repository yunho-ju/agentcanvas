// 붙여 넣거나 주소를 주면 skill이 된다 (DESIGN §7 skill-import-card).
// tool-wrap-card의 표면과 원칙을 물려받는다: 한 시점에 하나만 묻고, 승인 전에는 문서가 그대로다.
import { useEffect, useRef, useState } from "react";
import { countedLines } from "../graph/skills";
import { type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { STARTER_SKILLS } from "../registry/starterSkills";
import { useEditor } from "../store/editor";
import type { SkillSourceKind } from "../store/skillImportSlice";
import { skillImportReplaces } from "../store/skillImportSlice";
import { SkillBody } from "./SkillBody";
import { sourceCaption } from "./skillWords";

/** 미리보기에서 먼저 보여 주는 줄 수 — 나머지는 눌러서 편다. */
const PREVIEW_LINES = 12;

/** 어디서 가져오는가 — 종류가 늘면 여기 한 줄이다 (분기 대신 표). */
const SOURCE_KINDS: {
  kind: SkillSourceKind;
  name: MessageKey;
  label: MessageKey;
  placeholder: MessageKey;
}[] = [
  {
    kind: "paste",
    name: "skillImport.kind.paste",
    label: "skillImport.source.paste",
    placeholder: "skillImport.placeholder.paste",
  },
  {
    kind: "url",
    name: "skillImport.kind.url",
    label: "skillImport.source.url",
    placeholder: "skillImport.placeholder.url",
  },
];

function Asking() {
  const kind = useEditor((state) => state.skillImportKind);
  const source = useEditor((state) => state.skillImportSource);
  const loading = useEditor((state) => state.skillImportLoading);
  const error = useEditor((state) => state.skillImportError);
  const issues = useEditor((state) => state.skillImportIssues);
  const setKind = useEditor((state) => state.setSkillImportKind);
  const setSource = useEditor((state) => state.setSkillImportSource);
  const read = useEditor((state) => state.readSkillImport);
  const close = useEditor((state) => state.closeSkillImport);
  const pickStarter = useEditor((state) => state.pickStarterSkill);
  const box = useRef<HTMLTextAreaElement>(null);
  const t = useT();
  const chosen = SOURCE_KINDS.find((option) => option.kind === kind) ?? SOURCE_KINDS[0];
  const empty = source.trim() === "";

  // 열리면 손은 적을 자리에 놓인다.
  useEffect(() => box.current?.focus(), []);

  return (
    <>
      <p className="skill-import-card__description">{t("skillImport.description")}</p>
      <div
        className="skill-import-card__kinds"
        role="group"
        aria-label={t("skillImport.kind.label")}
      >
        {SOURCE_KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className="skill-import-card__kind"
            aria-pressed={option.kind === kind}
            disabled={loading}
            onClick={() => setKind(option.kind)}
          >
            {t(option.name)}
          </button>
        ))}
      </div>
      <label className="skill-import-card__label" htmlFor="skill-import-source">
        {t(chosen.label)}
      </label>
      <textarea
        id="skill-import-source"
        ref={box}
        className="control skill-import-card__source"
        value={source}
        disabled={loading}
        placeholder={t(chosen.placeholder)}
        aria-describedby={error || issues.length > 0 ? "skill-import-trouble" : undefined}
        onChange={(event) => setSource(event.target.value)}
      />
      {loading ? (
        <p className="skill-import-card__status" role="status">
          {t("skillImport.loading")}
        </p>
      ) : null}
      {error || issues.length > 0 ? (
        <div id="skill-import-trouble" className="skill-import-card__trouble" role="alert">
          {(error ? [error] : issues).map((line) => (
            <p className="skill-import-card__error" key={line.key}>
              {t(line)}
            </p>
          ))}
        </div>
      ) : null}
      <div className="skill-import-card__actions">
        <button
          type="button"
          className="button-primary"
          disabled={empty || loading}
          title={empty ? t("skillImport.read.disabled") : t("skillImport.read.hint")}
          onClick={() => void read()}
        >
          {t("skillImport.read")}
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={loading}
          title={t("skillImport.cancel.hint")}
          onClick={close}
        >
          {t("skillImport.cancel")}
        </button>
      </div>
      {/* 빈 칸 앞에서 멈추지 않게 — 고르면 곧장 미리보기로 간다 (프리셋 우선 원칙). */}
      <div
        className="skill-import-card__starters"
        role="group"
        aria-label={t("skillImport.starter")}
      >
        <span className="skill-import-card__starters-title">{t("skillImport.starter")}</span>
        {Object.values(STARTER_SKILLS).map((starter) => (
          <button
            key={starter.ref}
            type="button"
            className="skill-import-card__starter"
            disabled={loading}
            onClick={() => pickStarter(starter.ref)}
          >
            <span className="skill-import-card__starter-name">{starter.name}</span>
            <span className="skill-import-card__starter-what">{starter.description}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Reviewing() {
  const candidate = useEditor((state) => state.skillCandidate);
  const warnings = useEditor((state) => state.skillCandidateWarnings);
  const error = useEditor((state) => state.skillImportError);
  const replacing = useEditor(skillImportReplaces);
  const apply = useEditor((state) => state.applySkillImport);
  const rewrite = useEditor((state) => state.rewriteSkillImport);
  const [whole, setWhole] = useState(false);
  const t = useT();
  if (!candidate) return null;

  const lines = countedLines(candidate.body);
  const longer = lines > PREVIEW_LINES;

  return (
    <>
      <span className="skill-import-card__name">{candidate.name}</span>
      <p className="skill-import-card__what">{candidate.description}</p>
      <SkillBody body={candidate.body} lines={whole ? undefined : PREVIEW_LINES} />
      {longer && !whole ? (
        <button
          type="button"
          className="button-ghost skill-import-card__more"
          onClick={() => setWhole(true)}
        >
          {t("skillImport.more")}
        </button>
      ) : null}
      <span className="skill-import-card__caption">
        {t(sourceCaption(candidate))}
        {" · "}
        {candidate.license
          ? t("skillImport.license", { license: candidate.license })
          : t("skillImport.license.none")}
        {" · "}
        {t("skills.lines", { count: lines })}
      </span>
      {warnings.map((warning) => (
        <span className="skill-import-card__warn" key={warning.key}>
          {t(warning)}
        </span>
      ))}
      {/* 조용히 덮지 않는다 — 이전 판과 무엇이 달라지는지 줄 수로 말한다. */}
      {replacing ? (
        <span className="skill-import-card__caption">
          {t(
            msg("skillImport.replace.diff", {
              before: countedLines(replacing.body),
              after: lines,
            }),
          )}
        </span>
      ) : null}
      {error ? (
        <p className="skill-import-card__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="skill-import-card__actions">
        <button
          type="button"
          className="button-primary"
          title={replacing ? t("skillImport.replace.hint") : t("skillImport.apply.hint")}
          onClick={apply}
        >
          {t(replacing ? "skillImport.replace" : "skillImport.apply")}
        </button>
        <button
          type="button"
          className="button-ghost"
          title={t("skillImport.back.hint")}
          onClick={rewrite}
        >
          {t("skillImport.back")}
        </button>
      </div>
    </>
  );
}

export function SkillImportCard() {
  const mode = useEditor((state) => state.skillImportMode);
  const t = useT();

  // 카드가 물러나면 손은 이 카드를 부른 자리로 돌아간다 (open-dialog와 같은 규칙).
  // 부른 자리는 둘이다 — skill 패널의 버튼, 또는 입는 skill 칸의 버튼.
  const opener = useRef<HTMLElement | null>(null);
  if (mode !== "closed" && opener.current === null) {
    opener.current = document.activeElement as HTMLElement | null;
  }
  useEffect(() => {
    if (mode !== "closed") return;
    const called = opener.current;
    opener.current = null;
    if (called?.isConnected) called.focus();
  }, [mode]);

  if (mode === "closed") return null;
  const reviewing = mode === "review";

  return (
    <section
      className="skill-import-card layer"
      role="dialog"
      aria-label={t(reviewing ? "skillImport.review.title" : "skillImport.title")}
    >
      <h2 className="skill-import-card__title">
        {t(reviewing ? "skillImport.review.title" : "skillImport.title")}
      </h2>
      {reviewing ? <Reviewing /> : <Asking />}
    </section>
  );
}
