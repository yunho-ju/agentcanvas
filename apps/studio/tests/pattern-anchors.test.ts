// 앵커가 이 문서의 어느 단계가 되는가 — 엔진과 같은 케이스 파일을 읽어 같은 답을 낸다
// (examples/pattern-anchors, 미러 규율). 자리 정하기는 이 파일이 맞추지 않는다.
import { describe, expect, it } from "vitest";
import catalog from "../../../examples/pattern-anchors/catalog.json";
import cases from "../../../examples/pattern-anchors/cases.json";
import type { AgentSpec, Node1 as SpecNode } from "../src/generated/agent_spec";
import type { PatchTemplate } from "../src/generated/pattern_def";
import { resolveAnchors } from "../src/graph/patternAnchors";

interface AnchorCase {
  name: string;
  pattern: string;
  nodes: { id: string; type: string; config?: Record<string, unknown> }[];
  resources?: { id: string; approval_policy: string }[];
  edges?: [string, string][];
  selected?: string;
  anchors?: Record<string, string>;
  cannot?: string;
}

const templates = catalog as unknown as Record<string, PatchTemplate>;

function docOf(one: AnchorCase): Pick<AgentSpec, "nodes" | "resources"> {
  return {
    nodes: one.nodes.map(
      (node) => ({ ...node, position: { x: 0, y: 0 } }) as unknown as SpecNode,
    ),
    resources: (one.resources ?? []).map((resource) => ({
      ...resource,
      kind: "mcp",
      server_ref: `mcp://${resource.id}`,
    })) as unknown as AgentSpec["resources"],
  };
}

function answered(one: AnchorCase) {
  return resolveAnchors(templates[one.pattern], docOf(one), one.selected ?? null);
}

describe("resolveAnchors — 엔진과 나눠 읽는 케이스", () => {
  for (const one of cases as AnchorCase[]) {
    if (one.anchors) {
      it(`${one.name} — 케이스 파일이 적은 단계에 선다`, () => {
        expect(answered(one)).toEqual(one.anchors);
      });
    } else {
      it(`${one.name} — 케이스 파일이 적은 까닭을 말한다`, () => {
        expect(answered(one)).toMatchObject({ cannot: one.cannot });
      });
    }
  }

  // 표를 물려받은 이름으로 뒤져도 아는 작업이 되지 않는다 (Object.prototype의 것은 표의 것이 아니다).
  it("물려받은 이름을 작업 이름이라 말해도 그 줄은 아무것도 묻지 않는다", () => {
    const strange = [{ op: "constructor", node: "{agent}" }] as unknown as PatchTemplate;

    expect(resolveAnchors(strange, docOf(cases[0] as AnchorCase), null)).toEqual({});
  });

  // 못 놓는 답은 어느 단계 때문인지까지 말한다 — 화면이 그 자리를 가리킬 수 있어야 한다.
  it("애매하다는 답은 어느 종류의 단계가 여럿인지 함께 말한다", () => {
    const two = (cases as AnchorCase[]).find(
      (one) => one.cannot === "ambiguous_anchor",
    ) as AnchorCase;

    expect(answered(two)).toEqual({ cannot: "ambiguous_anchor", anchor: "{agent}" });
  });
});
