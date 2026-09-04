// '쓸 도구'가 무엇을 내놓고 무엇을 고른 것으로 세는가 — 화면 밖 순수 규칙 (DESIGN §7 agent-turns).
import { describe, expect, it } from "vitest";
import type { ResourceBinding } from "../src/generated/agent_spec";
import {
  bindingFilterName,
  bindingPickRows,
  resolvedPicks,
  unresolvedPicks,
} from "../src/inspector/bindingPicks";
import { describeForm } from "../src/inspector/schemaForm";
import { nodeTypes } from "../src/registry/registry";

function binding(id: string, tools: string[]): ResourceBinding {
  return {
    id,
    kind: "mcp.toolset",
    server_ref: `mcp://${id}`,
    tools: tools.map((name) => ({
      name,
      plain_description: { ko: name, en: name },
      input_schema: {},
      output_schema: {},
      timeout_ms: 1000,
      call: { transport: "mcp", remote_name: name },
    })),
  };
}

const WITH_TOOLS = binding("clinical", ["search", "get"]);
const WITHOUT_TOOLS: ResourceBinding = {
  id: "plain",
  kind: "mcp.toolset",
  server_ref: "mcp://plain",
};
const DOC = [WITH_TOOLS, WITHOUT_TOOLS];

const AGENT_SCHEMA = nodeTypes["llm.agent"].config_schema;
const TOOLS_FIELD = describeForm(AGENT_SCHEMA).fields.find(
  (field) => field.name === "toolset_refs",
);

describe("what the tool list is told to offer", () => {
  it("reads the filter the contract wrote on the field", () => {
    expect(bindingFilterName(TOOLS_FIELD?.schema ?? {})).toBe("with_tools");
  });

  it("offers only the connections that carry tools, with how many", () => {
    expect(bindingPickRows(DOC, "with_tools", [])).toEqual([
      { id: "clinical", toolCount: 2, known: true },
    ]);
  });

  // 거를 규칙을 말하지 않은 칸은 문서의 연결을 그대로 내놓는다.
  it("offers every connection when no filter was written", () => {
    expect(bindingPickRows(DOC, undefined, []).map((row) => row.id)).toEqual([
      "clinical",
      "plain",
    ]);
  });

  // 화면이 모르는 이름을 조용히 지우지 않는다 — 줄로 남아 뺄 수 있다.
  it("keeps a picked name the document does not have, marked as unknown", () => {
    expect(bindingPickRows(DOC, "with_tools", ["clinical", "gone"])).toEqual([
      { id: "clinical", toolCount: 2, known: true },
      { id: "gone", toolCount: 0, known: false },
    ]);
  });

  // 도구가 없어 목록에 서지 못한 연결을 골라 둔 것도 미해결이다.
  it("counts a picked connection without tools as unknown", () => {
    expect(bindingPickRows(DOC, "with_tools", ["plain"])).toEqual([
      { id: "clinical", toolCount: 2, known: true },
      { id: "plain", toolCount: 0, known: false },
    ]);
  });
});

describe("which picks the document can actually honour", () => {
  it("names every pick the offered list does not hold", () => {
    expect(unresolvedPicks(["clinical", "gone", "plain"], DOC, "with_tools")).toEqual([
      "gone",
      "plain",
    ]);
  });

  it("names nothing when every pick stands", () => {
    expect(unresolvedPicks(["clinical"], DOC, "with_tools")).toEqual([]);
  });

  // 오타 이름은 '고른 것'이 아니다 — 이 값으로 다른 칸의 잠금이 풀리면 거짓이다.
  it("hands the form only the picks that stand", () => {
    const values = { toolset_refs: ["gone"], max_turns: 3 };
    expect(resolvedPicks(AGENT_SCHEMA, values, DOC)).toEqual({
      toolset_refs: [],
      max_turns: 3,
    });
  });

  it("leaves a document that honours the picks untouched", () => {
    const values = { toolset_refs: ["clinical"] };
    expect(resolvedPicks(AGENT_SCHEMA, values, DOC)).toEqual({
      toolset_refs: ["clinical"],
    });
  });
});
