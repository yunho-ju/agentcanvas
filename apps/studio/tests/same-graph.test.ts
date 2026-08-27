// 같은 그래프인가를 재는 자 — 적는 방법이 달라도 내용이 같으면 같은 그래프다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import savedSpec from "../../../examples/basic-agent/saved_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { sameGraph } from "../src/graph/sameGraph";

const example = exampleSpec as unknown as AgentSpec;
const asServerWroteIt = savedSpec as unknown as AgentSpec;

describe("두 그래프가 같은 그래프인가", () => {
  it("서버가 적은 것과 화면이 적은 것은 같은 그래프다", () => {
    expect(sameGraph(example, { ...asServerWroteIt, revision: example.revision })).toBe(
      true,
    );
  });

  it("키를 적은 순서는 내용이 아니다", () => {
    const shuffled = {
      ...example,
      nodes: example.nodes.map((node) => ({
        config: node.config,
        position: node.position,
        type: node.type,
        id: node.id,
      })),
    } as AgentSpec;

    expect(sameGraph(example, shuffled)).toBe(true);
  });

  it("빈 자리를 적었는지도 내용이 아니다", () => {
    expect(sameGraph(example, { ...example, name: null })).toBe(true);
    expect(sameGraph({ ...example, resources: [] }, { ...example, resources: undefined })).toBe(
      true,
    );
  });

  it("값이 하나라도 다르면 다른 그래프다", () => {
    expect(sameGraph(example, { ...example, name: "임상 도우미" })).toBe(false);
    expect(sameGraph(example, { ...example, nodes: example.nodes.slice(1) })).toBe(false);
    expect(sameGraph(example, { ...example, revision: "sha256:" })).toBe(false);
  });

  it("노드의 자리가 옮겨졌으면 다른 그래프다", () => {
    const moved = {
      ...example,
      nodes: example.nodes.map((node, at) =>
        at === 0 ? { ...node, position: { x: 999, y: 999 } } : node,
      ),
    };

    expect(sameGraph(example, moved)).toBe(false);
  });

  it("없는 그래프끼리는 같고, 하나만 없으면 다르다 — 던지지 않는다", () => {
    expect(sameGraph(null, null)).toBe(true);
    expect(sameGraph(example, null)).toBe(false);
  });
});
