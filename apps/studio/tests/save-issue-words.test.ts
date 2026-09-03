// 저장 토스트가 "손볼 곳 N곳" 대신 첫 손볼 곳을 쉬운 말로 부르는 표 (DESIGN §7 GP-3).
import { describe, expect, it } from "vitest";
import type { SaveIssue } from "../src/api/specs";
import { saveIssueWords } from "../src/graph/saveIssueWords";
import { translate } from "../src/i18n/messages";

const CARD = "agent-1";

/** 화면이 그 카드를 부르는 이름 — 카드 제목과 같은 원천이다. */
function nameOf(nodeId: string): string | null {
  return nodeId === CARD ? "AI agent" : null;
}

function anIssue(over: Partial<SaveIssue> = {}): SaveIssue {
  return {
    severity: "warning",
    code: "graph.unreachable_node",
    message: "node 'agent-1' cannot be reached",
    node_id: CARD,
    ...over,
  };
}

function saidIn(locale: "ko" | "en", issues: SaveIssue[]): string {
  const words = saveIssueWords(issues, nameOf);
  return words ? translate(locale, words.message) : "";
}

describe("첫 손볼 곳을 부르는 말", () => {
  it.each([
    ["graph.unreachable_node", "'AI agent' 카드에 닿는 선이 없어요 — 입력에서부터 이어 주세요"],
    ["node.invalid_config", "'AI agent' 카드에 빈 칸이 있어요"],
    ["graph.cycle", "선이 고리를 만들어요 — 한 방향으로만 흐르게 해 주세요"],
    ["skill.missing", "'AI agent' 카드가 따르는 skill이 없어요"],
    ["node.unknown_binding", "'AI agent' 카드가 없는 연결을 가리켜요"],
  ])("%s는 카드 이름으로 말한다", (code, sentence) => {
    expect(saidIn("ko", [anIssue({ code })])).toBe(sentence);
  });

  it("이어진 두 칸의 종류가 안 맞는 일은 카드가 아니라 선의 이야기다", () => {
    const issue = anIssue({
      code: "port.schema_mismatch",
      node_id: undefined,
      edge_id: "edge-1",
    });

    expect(saidIn("ko", [issue])).toBe("이어진 두 칸의 종류가 안 맞아요");
    expect(saveIssueWords([issue], nameOf)?.nodeId).toBeNull();
  });

  it("영어로도 서버 원문이 아니라 우리 말로 말한다", () => {
    expect(saidIn("en", [anIssue()])).toBe(
      "Nothing leads to the 'AI agent' card — connect it from the input",
    );
  });

  it("데려갈 카드를 함께 알려 준다", () => {
    expect(saveIssueWords([anIssue()], nameOf)?.nodeId).toBe(CARD);
  });

  it("두 언어짜리 카드 이름은 읽는 언어를 따라간다", () => {
    const words = saveIssueWords([anIssue()], () => ({
      ko: "AI 에이전트",
      en: "AI agent",
    }));

    expect(words && translate("ko", words.message)).toBe(
      "'AI 에이전트' 카드에 닿는 선이 없어요 — 입력에서부터 이어 주세요",
    );
    expect(words && translate("en", words.message)).toBe(
      "Nothing leads to the 'AI agent' card — connect it from the input",
    );
  });

  it("표에 없는 code는 부를 말이 없다", () => {
    expect(saveIssueWords([anIssue({ code: "skill.duplicate" })], nameOf)).toBeNull();
  });

  // 서버가 보낸 글자를 표의 열쇠로 그대로 쓰면 자바스크립트가 물려준 이름까지 표에 있는 척한다.
  it("표의 것이 아닌 이름은 code여도 표에 없는 것이다", () => {
    expect(saveIssueWords([anIssue({ code: "toString" })], nameOf)).toBeNull();
  });

  it("알아 두면 좋은 이야기(info)뿐이면 부를 말이 없다", () => {
    expect(
      saveIssueWords([anIssue({ severity: "info", code: "skill.unused" })], nameOf),
    ).toBeNull();
  });

  it("info를 건너뛰고 첫 손볼 곳을 고른다", () => {
    const issues = [
      anIssue({ severity: "info", code: "skill.unused" }),
      anIssue({ code: "node.invalid_config" }),
    ];

    expect(saidIn("ko", issues)).toBe("'AI agent' 카드에 빈 칸이 있어요");
  });

  it("첫 손볼 곳이 표에 없으면 뒤의 아는 것을 대신 내세우지 않는다", () => {
    const issues = [anIssue({ code: "skill.duplicate" }), anIssue()];

    expect(saveIssueWords(issues, nameOf)).toBeNull();
  });

  // 화면에 없는 카드는 이름도 없고 데려갈 곳도 없다 — 빈칸이 남은 문장을 내보이지 않는다.
  it("화면에 없는 카드의 이야기는 부를 말이 없다", () => {
    expect(saveIssueWords([anIssue({ node_id: "gone" })], nameOf)).toBeNull();
  });

  it("손볼 곳이 아예 없으면 부를 말이 없다", () => {
    expect(saveIssueWords([], nameOf)).toBeNull();
  });
});
