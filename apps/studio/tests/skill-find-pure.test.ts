// 찾은 줄들을 한 목록으로 놓는 순수한 셈 (DESIGN §7 skill-find).
// 차례는 이 문서 → 시작 skill → 바깥이고, 문서에 이미 있는 이름은 그렇게 말한다.
import { describe, expect, it } from "vitest";
import type { SkillDef } from "../src/generated/skill_def";
import { documentMatches, mergeHits, type ServerHit } from "../src/graph/skillHits";

function aSkill(name: string, description: string): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description,
    body: "Do it like this.\n",
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

const REMOTE: ServerHit = {
  name: "table-tidy",
  description: null,
  origin: "remote",
  url: "https://skills.sh/acme/kit/table-tidy",
  installs: 12000,
  owner_repo: "acme/kit",
  ref: null,
};

const STARTER: ServerHit = {
  name: "plain-answer",
  description: "Use when the reader is not an expert.",
  origin: "starter",
  url: null,
  installs: null,
  owner_repo: null,
  ref: "skill://plain-answer@1",
};

describe("찾은 줄을 한 목록으로", () => {
  it("이 문서의 것이 앞에 서고 시작 skill, 바깥이 뒤따른다", () => {
    const held = [aSkill("house-style", "Use when the answer goes out under our name.")];

    const found = mergeHits(held, [STARTER, REMOTE], held);

    expect(found.map((one) => one.origin)).toEqual(["document", "starter", "remote"]);
    expect(found[0].name).toBe("house-style");
    expect(found[2].ownerRepo).toBe("acme/kit");
    expect(found[2].installs).toBe(12000);
  });

  it("문서에 같은 이름이 이미 있는 줄은 이미 있다고 말하고 그 문서의 것을 가리킨다", () => {
    const held = [aSkill("plain-answer", "The one we already keep.")];

    const found = mergeHits(held, [STARTER], held);

    const same = found.filter((one) => one.name === "plain-answer");
    expect(same).toHaveLength(2);
    expect(same[1].alreadyHave).toBe(true);
    // 누르면 가져오기가 아니라 그 문서의 것을 읽는다 — 이름표가 문서의 것이다.
    expect(same[1].ref).toBe("skill://plain-answer@1");
    expect(same[0].alreadyHave).toBe(false);
  });

  it("이미 있는지는 이 문서 전부에 대고 묻는다 — 물음에 닿은 줄만 보고 묻지 않는다", () => {
    const held = [aSkill("table-tidy", "Use when numbers should be laid out.")];

    // 물음("spreadsheet")에 닿은 문서 줄은 하나도 없지만, 그 이름은 문서에 있다.
    const found = mergeHits(held, [{ ...REMOTE, name: "table-tidy" }], []);

    expect(found.map((one) => one.origin)).toEqual(["remote"]);
    expect(found[0].alreadyHave).toBe(true);
    expect(found[0].ref).toBe("skill://table-tidy@1");
  });

  it("문서에 없는 이름은 이미 있다고 말하지 않는다", () => {
    const found = mergeHits([], [STARTER, REMOTE], []);

    expect(found.every((one) => one.alreadyHave === false)).toBe(true);
  });

  it("줄마다 제 이름표를 가진다 — 같은 이름이 둘이어도 서로를 덮지 않는다", () => {
    const held = [aSkill("plain-answer", "The one we already keep.")];

    const keys = mergeHits(held, [STARTER], held).map((one) => one.key);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("이 문서에서 무엇이 물음에 닿는가", () => {
  it("낱말이 겹치는 것만 고른다 — 겹치지 않으면 결과가 아니다", () => {
    const held = [
      aSkill("table-tidy", "Use when numbers should be laid out as a table."),
      aSkill("ask-first", "Use when a step could send a message."),
    ];

    expect(documentMatches("table", held).map((one) => one.name)).toEqual(["table-tidy"]);
    expect(documentMatches("zzzz", held)).toEqual([]);
  });

  it("본문은 셈에 들지 않는다 — 찾기는 이름과 쓰임새로 찾는다", () => {
    const held = [
      { ...aSkill("quiet", "Use when the answer is short."), body: "table table table\n" },
    ];

    expect(documentMatches("table", held)).toEqual([]);
  });
});
