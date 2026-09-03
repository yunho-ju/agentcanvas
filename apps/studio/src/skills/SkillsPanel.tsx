// 이 문서가 가진 skill을 보고, 읽고, 지우는 자리 (DESIGN §7 skills-panel).
// 연결 패널과 같은 문법이다 — 다른 것은 줄의 내용과 [읽기]뿐이다.
import { useState } from "react";
import type { SkillDef } from "../generated/skill_def";
import { duplicateSkillRefs } from "../graph/skillIssues";
import { countedLines, nodesWearing } from "../graph/skills";
import { useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { docSkills } from "../store/skillSlice";
import { SkillBody } from "./SkillBody";
import { sourceCaption } from "./skillWords";

function Skill({ skill, twice }: { skill: SkillDef; twice: boolean }) {
  const running = useEditor(isRunning);
  const nodes = useEditor((state) => state.nodes);
  const remove = useEditor((state) => state.removeSkill);
  const [reading, setReading] = useState(false);
  const t = useT();
  const wearers = nodesWearing(nodes, skill.ref);

  return (
    <li className="skills-panel__skill" aria-label={skill.name}>
      <span className="skills-panel__name">{skill.name}</span>
      <span className="skills-panel__what">{skill.description}</span>
      {/* 같은 이름표가 두 번 든 문서는 잘못이다 (validator skill.duplicate) — 그 줄에서 말한다. */}
      {twice ? <span className="skills-panel__warn">{t("skills.duplicate")}</span> : null}
      <span className="skills-panel__from">{t(sourceCaption(skill))}</span>
      {wearers.length === 0 ? (
        <span className="skills-panel__idle">{t("skills.wornBy.none")}</span>
      ) : (
        <span className="skills-panel__wearers">
          <span className="skills-panel__wearers-label">{t("skills.wornBy")}</span>
          {wearers.map((id) => (
            <span className="skills-panel__wearer" key={id}>
              {id}
            </span>
          ))}
        </span>
      )}
      <div className="skills-panel__actions">
        <button
          type="button"
          className="button-ghost skills-panel__read"
          aria-expanded={reading}
          title={t("skills.read.hint")}
          onClick={() => setReading(!reading)}
        >
          {t("skills.read")}
        </button>
        {/* 지우기는 inspector 카드의 지우기 문법 그대로 — 되묻지 않고, 되돌리기가 지킨다. */}
        <button
          type="button"
          className="button-ghost skills-panel__delete"
          disabled={running}
          title={running ? t(LOCKED_HINT) : t("skills.delete.hint")}
          onClick={() => remove(skill.ref)}
        >
          {t("skills.delete")}
        </button>
      </div>
      <span className="skills-panel__undo">{t("inspector.delete.undo")}</span>
      {reading ? (
        <>
          <span className="skills-panel__length">
            {t("skills.lines", { count: countedLines(skill.body) })}
          </span>
          <SkillBody body={skill.body} />
        </>
      ) : null}
    </li>
  );
}

export function SkillsPanel() {
  const skills = useEditor(docSkills);
  // 같은 이름표를 두 번 든 문서인가 — 판정은 validator(graph/skillIssues)의 것을 그대로 읽는다.
  const twiceHeld = duplicateSkillRefs(skills);
  const running = useEditor(isRunning);
  const openSkillImport = useEditor((state) => state.openSkillImport);
  const t = useT();

  return (
    <section className="skills-panel" aria-label={t("skills.title")}>
      <h2 className="skills-panel__title">{t("skills.title")}</h2>
      {/* 용어는 첫 등장에서 설명과 함께 선다 (DESIGN §7 skill-wear 용어 규칙). */}
      <p className="skills-panel__explain">{t("skills.explain")}</p>
      {skills.length === 0 ? (
        <p className="skills-panel__empty">{t("skills.empty")}</p>
      ) : (
        <ul className="skills-panel__list">
          {skills.map((skill, order) => (
            // 같은 이름표가 두 번 들었을 수 있다 — 줄을 가리키는 것은 그 자리(order)다.
            <Skill
              skill={skill}
              twice={twiceHeld.includes(skill.ref)}
              key={`${skill.ref}-${order}`}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button-primary skills-panel__new"
        disabled={running}
        title={running ? t(LOCKED_HINT) : t("skills.new.hint")}
        onClick={openSkillImport}
      >
        {t("skills.new")}
      </button>
    </section>
  );
}
