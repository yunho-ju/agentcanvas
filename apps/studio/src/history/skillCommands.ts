// 문서가 가진 skill을 바꾸는 편집 — 들이기·갈아 끼우기·빼기. 다른 편집과 같은
// 되돌리기 목록에 쌓인다 (연결에 대한 같은 자리: history/docCommands).
import type { SkillDef } from "../generated/skill_def";
import { withNodeConfig } from "../graph/config";
import type { Scene } from "../graph/scene";
import { withSkill, withoutSkill } from "../graph/skills";
import { type Message, msg } from "../i18n/messages";
import { skillRefField } from "../registry/registry";
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

/** 이 칸에 적혀 있는 이름표들 — 글자가 아닌 것은 이 칸의 값이 아니다 (skill-wear와 같은 읽기). */
function wornRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];
}

/**
 * 만든 skill 하나를 문서에 들이고, 그 단계가 곧바로 따르게 한다 (DESIGN §7 skill-make-card).
 * 두 가지가 **한 걸음**이다: 문서의 skill 목록과 그 단계의 입는 목록은 함께 오간다 —
 * 되돌리기 한 번이 반쯤 지운 문서를 남기면 그것은 되돌리기가 아니다.
 * 같은 이름표가 이미 있으면 갈아 끼우고(가져오기와 같은 규칙), 입는 목록에는 두 번 서지 않는다.
 *
 * 입을 칸이 어디인지는 registry가 답한다(화면도 store도 칸 이름을 외우지 않는다). 그런 칸이
 * 없는 단계라면 이 편집은 아무것도 하지 않는다 — 절반만 적용된 문서를 남기지 않는다.
 */
export function takeInSkillAndWear(
  scene: Scene,
  skill: SkillDef,
  nodeId: string,
): Command {
  const wearer = scene.nodes.find((node) => node.id === nodeId);
  const nodeType = wearer?.data.nodeType;
  const field = nodeType ? skillRefField(nodeType) : undefined;
  if (!wearer || !field) return doNothing;
  const skills = scene.skills;
  const next = withSkill(skills, skill);
  const worn = wornRefs(wearer.data.spec.config?.[field]);
  const config = {
    ...(wearer.data.spec.config ?? {}),
    [field]: worn.includes(skill.ref) ? worn : [...worn, skill.ref],
  };
  const was = wearer.data;
  return {
    label: msg("edit.takeInSkillAndWear"),
    apply: (current) => ({
      ...current,
      skills: next,
      ...withNodeConfig(
        current,
        nodeId,
        config,
        current.input_schema,
        current.resources,
      ).graph,
    }),
    revert: (current) => ({
      ...current,
      skills,
      // 노드는 그대로 두고 설정과 포트만 되돌린다 (설정 편집의 되돌림과 같은 자리).
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: was } : node,
      ),
    }),
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
