// 붙여 넣거나 주소를 주면 skill이 된다 (DESIGN §7 skill-import-card).
// tool-wrap-card의 표면과 원칙을 물려받는다: 한 시점에 하나만 묻고, 승인 전에는 문서가 그대로다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillDef } from "../generated/skill_def";
import { countedLines } from "../graph/skills";
import { type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { STARTER_SKILLS } from "../registry/starterSkills";
import { useEditor } from "../store/editor";
import { docSkills } from "../store/skillSlice";
import type { SkillImportKind, SkillSourceKind } from "../store/skillImportSlice";
import { skillImportReplaces } from "../store/skillImportSlice";
import { skillMakeReferences } from "../store/skillMakeSlice";
import { SkillBody } from "./SkillBody";
import { SkillFindView } from "./SkillFindView";
import { skillDescriptionProblem, skillNameProblem, sourceCaption } from "./skillWords";

/** 미리보기에서 먼저 보여 주는 줄 수 — 나머지는 눌러서 편다. */
const PREVIEW_LINES = 12;

/** 만들기 모드의 지시문 미리보기에서 먼저 보여 주는 줄 수. */
const INSTRUCTION_PREVIEW_LINES = 6;

/**
 * 승인 손잡이가 무엇이라 말하는가 — 무엇을 하러 왔는가(가져오기/만들기) × 같은 이름이 이미 있는가.
 * 분기 대신 표다: 새 모드가 생기면 여기 한 줄이다.
 */
const APPROVAL: Record<
  "import" | "make",
  Record<"add" | "swap", { label: MessageKey; hint: MessageKey }>
> = {
  import: {
    add: { label: "skillImport.apply", hint: "skillImport.apply.hint" },
    swap: { label: "skillImport.replace", hint: "skillImport.replace.hint" },
  },
  make: {
    add: { label: "skillMake.apply", hint: "skillMake.apply.hint" },
    swap: { label: "skillMake.replace", hint: "skillMake.replace.hint" },
  },
};

/** 어디서 가져오는가 — 종류가 늘면 여기 한 줄이다 (분기 대신 표). */
const SOURCE_KINDS: {
  kind: SkillImportKind;
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
  {
    kind: "find",
    name: "skillImport.kind.find",
    label: "skillFind.label",
    placeholder: "skillFind.placeholder",
  },
];

function Asking() {
  const kind = useEditor((state) => state.skillImportKind);
  const loading = useEditor((state) => state.skillImportLoading);
  const setKind = useEditor((state) => state.setSkillImportKind);
  const t = useT();

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
      {kind === "find" ? <SkillFindView /> : <Giving kind={kind} />}
    </>
  );
}

/** 붙여 넣은 글이나 주소를 받는 자리 — 모델을 부르지 않고 파서가 그 자리에서 읽는다. */
function Giving({ kind }: { kind: SkillSourceKind }) {
  const source = useEditor((state) => state.skillImportSource);
  const loading = useEditor((state) => state.skillImportLoading);
  const error = useEditor((state) => state.skillImportError);
  const issues = useEditor((state) => state.skillImportIssues);
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

/** 참고로 읽어 볼 skill 한 줄 — 고르는 것이 아니라 펴 보는 것이다. */
function Reference({ skill }: { skill: SkillDef }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="skill-import-card__reference">
      <button
        type="button"
        className="skill-import-card__starter"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="skill-import-card__starter-name">{skill.name}</span>
        <span className="skill-import-card__starter-what">{skill.description}</span>
      </button>
      {open ? <SkillBody body={skill.body} /> : null}
    </div>
  );
}

/**
 * 이 지시문을 skill로 만드는 자리 (DESIGN §7 skill-make-card).
 * 가져오기와 한 카드다 — 다른 것은 무엇을 묻는가뿐이고, 미리보기부터는 같은 길을 간다.
 */
function Making() {
  const making = useEditor((state) => state.skillMake);
  const name = useEditor((state) => state.skillMakeName);
  const description = useEditor((state) => state.skillMakeDescription);
  const loading = useEditor((state) => state.skillImportLoading);
  const error = useEditor((state) => state.skillImportError);
  const issues = useEditor((state) => state.skillImportIssues);
  const skills = useEditor(docSkills);
  // 참고를 고르는 규칙은 store와 같은 한 곳이다 — 화면이 셈을 다시 적지 않는다.
  // 고른 목록은 매번 새 배열이라 무엇이 바뀌었을 때만 다시 고른다 (EvalSuggestCards와 같은 문법).
  const references = useMemo(
    () => skillMakeReferences(useEditor.getState()),
    [making, name, description, skills],
  );
  const setName = useEditor((state) => state.setSkillMakeName);
  const setDescription = useEditor((state) => state.setSkillMakeDescription);
  const draft = useEditor((state) => state.draftSkill);
  const close = useEditor((state) => state.closeSkillImport);
  const [whole, setWhole] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const t = useT();

  // 열리면 손은 적을 자리에 놓인다 (가져오기 카드와 같은 규칙).
  useEffect(() => box.current?.focus(), []);
  if (!making) return null;

  const lines = countedLines(making.instruction);
  const nameProblem = skillNameProblem(name);
  const descriptionProblem = skillDescriptionProblem(description);
  // 닿지 못한 까닭이 있으면 그것을, 없으면 읽지 못한 까닭들을 말한다 (가져오기 카드와 같은 규칙).
  const trouble = error ? [error] : issues;
  // 그릴 때 막는다 — 무엇이 모자란지 그 손잡이가 말한다 (§9).
  const blocked = nameProblem ?? descriptionProblem;

  return (
    <>
      <p className="skill-import-card__description">{t("skillMake.explain")}</p>
      <span className="skill-import-card__label">{t("skillMake.instruction.label")}</span>
      <SkillBody
        body={making.instruction}
        lines={whole ? undefined : INSTRUCTION_PREVIEW_LINES}
      />
      {lines > INSTRUCTION_PREVIEW_LINES && !whole ? (
        <button
          type="button"
          className="button-ghost skill-import-card__more"
          onClick={() => setWhole(true)}
        >
          {t("skillImport.more")}
        </button>
      ) : null}
      <label className="skill-import-card__label" htmlFor="skill-make-name">
        {t("skillMake.name.label")}
      </label>
      <input
        id="skill-make-name"
        ref={box}
        type="text"
        className="control"
        value={name}
        disabled={loading}
        placeholder={t("skillMake.name.placeholder")}
        aria-describedby={nameProblem ? "skill-make-trouble" : undefined}
        onChange={(event) => setName(event.target.value)}
      />
      {/* 이름 규칙은 그릴 때 막는다 — 적는 동안 한 줄로 말한다 (원문 코드 금지). */}
      {nameProblem && name !== "" ? (
        <p id="skill-make-trouble" className="skill-import-card__error" role="alert">
          {t(nameProblem)}
        </p>
      ) : null}
      <label className="skill-import-card__label" htmlFor="skill-make-what">
        {t("skillMake.description.label")}
      </label>
      <input
        id="skill-make-what"
        type="text"
        className="control"
        value={description}
        disabled={loading}
        placeholder={t("skillMake.description.placeholder")}
        aria-describedby={descriptionProblem ? "skill-make-what-trouble" : undefined}
        onChange={(event) => setDescription(event.target.value)}
      />
      {/* 길이 규칙도 그릴 때 막는다 — 청을 보내 놓고 서버가 물리게 하지 않는다 (§9). */}
      {descriptionProblem && description !== "" ? (
        <p id="skill-make-what-trouble" className="skill-import-card__error" role="alert">
          {t(descriptionProblem)}
        </p>
      ) : null}
      {/* 참고할 것이 없으면 목록 자체가 없다 — 빈 목록을 말없이 던지지 않는다 (§9). */}
      {references.length > 0 ? (
        <div
          className="skill-import-card__starters"
          role="group"
          aria-label={t("skillMake.references")}
        >
          <span className="skill-import-card__starters-title">
            {t("skillMake.references")}
          </span>
          <span className="skill-import-card__caption">{t("skillMake.references.hint")}</span>
          {references.map((skill) => (
            <Reference key={skill.ref} skill={skill} />
          ))}
        </div>
      ) : null}
      {loading ? (
        <p className="skill-import-card__status" role="status">
          {t("skillMake.loading")}
        </p>
      ) : null}
      {/* 지어 온 글을 읽지 못한 까닭도 여기서 말한다 — 말없이 삼키면 손잡이가 죽은 것이 된다
          (가져오기 카드와 같은 자리·같은 문법). */}
      {trouble.length > 0 ? (
        <div className="skill-import-card__trouble" role="alert">
          {trouble.map((line) => (
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
          disabled={blocked !== null || loading}
          title={t(blocked ?? msg("skillMake.draft.hint"))}
          onClick={() => void draft()}
        >
          {t("skillMake.draft")}
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
    </>
  );
}

function Reviewing() {
  const candidate = useEditor((state) => state.skillCandidate);
  const warnings = useEditor((state) => state.skillCandidateWarnings);
  const error = useEditor((state) => state.skillImportError);
  const replacing = useEditor(skillImportReplaces);
  const making = useEditor((state) => state.skillMake);
  const draftedBy = useEditor((state) => state.skillDraftedBy);
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
      {/* 부를 모델이 없어 틀만 잡았으면 그렇게 말한다 — 지어낸 것을 지은 것이라 하지 않는다. */}
      {making && draftedBy === "scaffold" ? (
        <span className="skill-import-card__warn">{t("skillMake.scaffold")}</span>
      ) : null}
      {making ? (
        <span className="skill-import-card__caption">{t("skillMake.review.caption")}</span>
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
          title={t(APPROVAL[making ? "make" : "import"][replacing ? "swap" : "add"].hint)}
          onClick={apply}
        >
          {t(APPROVAL[making ? "make" : "import"][replacing ? "swap" : "add"].label)}
        </button>
        <button
          type="button"
          className="button-ghost"
          title={t(making ? "skillMake.again.hint" : "skillImport.back.hint")}
          onClick={rewrite}
        >
          {t(making ? "skillMake.again" : "skillImport.back")}
        </button>
      </div>
    </>
  );
}

/** 한 카드, 두 모드 × 두 상태 — 제목은 지금 무엇을 묻는지 말한다 (분기 대신 표). */
const TITLES: Record<"import" | "make", Record<"input" | "review", MessageKey>> = {
  import: { input: "skillImport.title", review: "skillImport.review.title" },
  make: { input: "skillMake.title", review: "skillMake.review.title" },
};

export function SkillImportCard() {
  const mode = useEditor((state) => state.skillImportMode);
  const making = useEditor((state) => state.skillMake);
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
  const title = TITLES[making ? "make" : "import"][reviewing ? "review" : "input"];

  return (
    <section className="skill-import-card layer" role="dialog" aria-label={t(title)}>
      <h2 className="skill-import-card__title">{t(title)}</h2>
      {reviewing ? <Reviewing /> : making ? <Making /> : <Asking />}
    </section>
  );
}
