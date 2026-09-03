// 번들 시작 skill이 화면에도 같은 모습으로 도착하는가 — Python `starter_skills`의 TS 미러.
// 목록은 생성물(json_schema/starter_skills.json) 하나에서만 나온다: 화면에 손으로 적지 않는다.
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown, renderSkillMarkdown } from "../src/graph/skillMarkdown";
import { STARTER_SKILLS, resolveStarterSkill } from "../src/registry/starterSkills";

describe("번들 시작 skill", () => {
  it("우리가 싣는 세 벌이다", () => {
    expect(Object.keys(STARTER_SKILLS).sort()).toEqual([
      "skill://ask-before-acting@1",
      "skill://cite-sources@1",
      "skill://plain-answer@1",
    ]);
  });

  it.each(Object.keys(STARTER_SKILLS))("%s 은 이름표로 찾을 수 있다", (ref) => {
    expect(resolveStarterSkill(ref)?.ref).toBe(ref);
  });

  it("모르는 이름에는 던지지 않고 없다고 답한다", () => {
    expect(resolveStarterSkill("skill://not-a-starter@1")).toBeUndefined();
  });

  it.each(Object.keys(STARTER_SKILLS))(
    "%s 을 표준 파일로 써서 다시 읽으면 같은 skill이다 — 두 언어가 같은 글을 본다",
    (ref) => {
      const skill = STARTER_SKILLS[ref];
      const parsed = parseSkillMarkdown(renderSkillMarkdown(skill));
      expect(parsed.issues).toEqual([]);
      expect(parsed.skill).toEqual(skill);
    },
  );

  it.each(Object.keys(STARTER_SKILLS))("%s 은 한국어 이름을 함께 들고 온다", (ref) => {
    expect(STARTER_SKILLS[ref].metadata?.["ko-title"]).toBeTruthy();
  });
});
