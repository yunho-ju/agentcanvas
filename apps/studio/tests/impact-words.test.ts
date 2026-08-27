import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { analyzeDetach } from "../src/graph/impact";
import { impactLines, type Tense } from "../src/graph/impactWords";
import { toFlow } from "../src/graph/serialize";
import type { Impact } from "../src/graph/impact";
import type { Locale } from "../src/i18n/locale";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;
const hub = analyzeDetach(toFlow(example), "triage");
const harmless = analyzeDetach(toFlow(example), "ghost");

function lines(impact: Impact, tense: Tense, locale: Locale = "ko"): string[] {
  return impactLines(impact, tense).map((line) => translate(locale, line));
}

describe("saying what an edit costs, in plain words", () => {
  it("counts the connections that are about to be cut", () => {
    expect(lines(hub, "will")).toContain("연결 2개가 끊어진다");
  });

  it("counts the nodes that are about to lose their data", () => {
    expect(lines(hub, "will")).toContain("노드 3개에 데이터가 닿지 않게 된다");
  });

  it("says the same thing in the past once the edit is done", () => {
    expect(lines(hub, "did")).toEqual([
      "연결 2개가 끊어졌다",
      "노드 3개에 데이터가 닿지 않게 됐다",
    ]);
  });

  it("reassures the user when nothing breaks", () => {
    expect(lines(harmless, "will")).toEqual(["아무것도 끊어지지 않는다"]);
  });

  it("leaves out the half that is not affected", () => {
    const leaf = analyzeDetach(toFlow(example), "output");
    expect(lines(leaf, "will")).toEqual(["연결 1개가 끊어진다"]);
  });

  it("keeps technical words out of the summary", () => {
    expect(lines(hub, "will").join(" ")).not.toMatch(/포트|엣지|edge|port|schema/);
  });

  it("says the same count to a reader of english", () => {
    expect(lines(hub, "will", "en")).toEqual([
      "Connections that will be cut: 2",
      "Nodes that will stop getting data: 3",
    ]);
    expect(lines(harmless, "will", "en")).toEqual(["Nothing gets cut off"]);
  });

  it("keeps the same shape of answer in both languages", () => {
    expect(lines(hub, "did", "en")).toHaveLength(lines(hub, "did", "ko").length);
  });
});
