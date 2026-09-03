// 문서가 가진 skill을 바꾸는 편집 — 들이기·갈아 끼우기·빼기. 다른 편집과 같은
// 되돌리기 목록에 쌓인다 (연결에 대한 같은 자리: history/docCommands).
import type { SkillDef } from "../generated/skill_def";
import { withSkill, withoutSkill } from "../graph/skills";
import { type Message, msg } from "../i18n/messages";
import { type Command, doNothing } from "./command";

/** 승인한 skill 하나를 문서에 들인다. 승인 1회 = 되돌리기 한 걸음이다. */
export function takeInSkill(current: SkillDef[], skill: SkillDef): Command {
  const next = withSkill(current, skill);
  return {
    label: msg("edit.takeInSkill"),
    apply: (scene) => ({ ...scene, skills: next }),
    revert: (scene) => ({ ...scene, skills: current }),
  };
}

/** 같은 이름표의 skill을 새 판으로 갈아 끼운다 — 없는 이름표면 아무 일도 하지 않는다. */
export function swapSkill(current: SkillDef[], skill: SkillDef): Command {
  if (!current.some((one) => one.ref === skill.ref)) return doNothing;
  const next = withSkill(current, skill);
  return {
    label: msg("edit.swapSkill"),
    apply: (scene) => ({ ...scene, skills: next }),
    revert: (scene) => ({ ...scene, skills: current }),
  };
}

/**
 * skill 하나를 문서에서 뺀다 — 그것을 입고 있던 노드의 설정은 건드리지 않는다.
 * 구조는 아무것도 빠지지 않고, 뒤에 남는 상태는 노드 뱃지·필드 오류가 말한다
 * (연결 지우기와 같은 규칙). 입고 있던 단계가 있으면 그 사실만 그 자리에서 말한다.
 */
export function dropSkill(
  current: SkillDef[],
  ref: string,
  wearing: string[] = [],
): Command {
  const target = current.find((one) => one.ref === ref);
  if (!target) return doNothing;
  const left = withoutSkill(current, ref);
  const notice: Message | undefined =
    wearing.length === 0
      ? undefined
      : msg("edit.dropSkill.notice", { name: target.name, nodes: wearing.join(", ") });
  return {
    label: msg("edit.dropSkill"),
    ...(notice ? { notice } : {}),
    apply: (scene) => ({ ...scene, skills: left }),
    revert: (scene) => ({ ...scene, skills: current }),
  };
}
