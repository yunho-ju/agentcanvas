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

  it("계약이 대신 적어 주는 기본값을 적었는지도 내용이 아니다", () => {
    // 손으로 적은 문서는 도구의 처리 방법을 비워 두고, 서버는 기본값을 적어 돌려준다.
    const written = {
      ...example,
      resources: (example.resources ?? []).map((binding) => ({
        ...binding,
        tools: (binding.tools ?? []).map(({ result_handling, ...rest }) => rest),
      })),
    } as unknown as AgentSpec;

    expect(sameGraph(written, asServerWroteIt)).toBe(true);
  });

  it("기본값 규칙은 그 자리에만 물린다 — 사람이 적은 데이터는 지우지 않는다", () => {
    // 같은 이름이 사용자의 schema 안에 있을 수 있다. 그것은 계약의 기본값이 아니라 내용이다.
    const withField = (value: unknown) =>
      ({
        ...example,
        input_schema: {
          type: "object",
          properties: { result_handling: value },
        },
      }) as unknown as AgentSpec;

    expect(sameGraph(withField({ mode: "full" }), withField(undefined))).toBe(false);
  });

  it("기본값인지는 적은 차례가 아니라 내용으로 가린다", () => {
    const handled = (handling: Record<string, unknown>) =>
      ({
        ...example,
        resources: (example.resources ?? []).map((binding) => ({
          ...binding,
          tools: (binding.tools ?? []).map((tool) => ({
            ...tool,
            result_handling: handling,
          })),
        })),
      }) as unknown as AgentSpec;

    // 키를 적은 차례가 달라도 같은 기본값이면 둘 다 "적지 않은 것"과 같다.
    expect(sameGraph(handled({ mode: "full" }), asServerWroteIt)).toBe(true);
    // 기본값이 아닌 처리 방법은 내용이다 — 지우지 않는다.
    expect(sameGraph(handled({ mode: "sections", section_param: "part" }), asServerWroteIt)).toBe(
      false,
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
