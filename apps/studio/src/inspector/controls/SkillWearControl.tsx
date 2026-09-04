// 이 단계가 따를 skill을 고르는 칸 (DESIGN §7 skill-wear) — 그리기만 한다.
// 셀렉트가 아니라 체크 목록이다: 한 단계가 여러 skill을 입는다. 체크 1회 = 되돌리기 한 걸음.
// 판정(문서에 없는 skill)은 필드 오류와 노드 뱃지가 하고, 여기서는 그 줄을 잃지 않게만 한다.
import { localized } from "../../i18n/locale";
import { useLocale, useT } from "../../i18n/useT";
import { nameInSkillRef } from "../../graph/skillMarkdown";
import { LOCKED_HINT } from "../../run/lockWords";
import { useEditor } from "../../store/editor";
import { isRunning } from "../../store/runSlice";
import { docSkills } from "../../store/skillSlice";
import type { ControlProps } from "./types";

/** 이 칸에 적혀 있는 이름표들 — 글자가 아닌 것은 이 칸의 값이 아니다. */
function wornRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

interface WearRow {
  ref: string;
  name: string;
  caption: string;
  /** 입고 있지만 문서에는 없는 skill — 체크를 풀면 이 줄은 사라진다 */
  stale: boolean;
}

export function SkillWearControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const skills = useEditor(docSkills);
  const openSkillImport = useEditor((state) => state.openSkillImport);
  const running = useEditor(isRunning);

  const locked = props.disabled === true || running;
  const worn = wornRefs(props.value);
  const held = new Set(skills.map((skill) => skill.ref));
  const rows: WearRow[] = [
    ...skills.map((skill) => ({
      ref: skill.ref,
      name: skill.name,
      caption: skill.description,
      stale: false,
    })),
    // 문서에 없는 이름표도 조용히 지우지 않는다 — 체크된 채 까닭을 달고 남는다.
    ...worn
      .filter((ref) => !held.has(ref))
      .map((ref) => ({
        ref,
        name: nameInSkillRef(ref) ?? ref,
        caption: t("control.skillWear.stale"),
        stale: true,
      })),
  ];

  function toggle(ref: string, on: boolean) {
    // 고르는 일은 글자를 이어 적는 일과 다르다 — 고를 때마다 되돌릴 걸음 하나다.
    props.onChange(
      on ? [...worn, ref] : worn.filter((one) => one !== ref),
      { merge: false },
    );
  }

  return (
    <div
      className="skill-wear"
      role="group"
      aria-label={localized(props.field.label, locale)}
      aria-describedby={props.describedBy}
    >
      <span className="skill-wear__explain">{t("control.skillWear.explain")}</span>
      {rows.length === 0 ? (
        <span className="skill-wear__empty">{t("control.skillWear.empty")}</span>
      ) : (
        <ul className="skill-wear__list">
          {rows.map((row) => (
            <li className="skill-wear__row" key={row.ref}>
              <label className="skill-wear__pick">
                <input
                  type="checkbox"
                  className="control control--check"
                  checked={worn.includes(row.ref)}
                  disabled={locked}
                  title={props.disabled ? props.title : undefined}
                  onChange={(event) => toggle(row.ref, event.target.checked)}
                />
                <span className="skill-wear__name">{row.name}</span>
              </label>
              <span
                className={
                  row.stale ? "skill-wear__warn" : "skill-wear__what"
                }
              >
                {row.caption}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button-ghost skill-wear__import"
        disabled={locked}
        title={running ? t(LOCKED_HINT) : (props.title ?? t("skills.new.hint"))}
        onClick={openSkillImport}
      >
        {t("control.skillWear.import")}
      </button>
    </div>
  );
}
