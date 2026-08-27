// 그리는 순간에 순환을 막는가 — Python validator의 `graph.cycle`과 같은 판정이어야 한다.
// 같은 케이스 파일을 packages/engine/tests/test_connection_cycles.py도 읽는다:
// 저쪽은 그은 연결까지 넣은 그래프를 validate_graph에게 묻고, 여기서는 그 연결을
// checkConnection에게 묻는다. 케이스의 노드는 모두 llm.router라 타입은 걸리지 않는다.
import { describe, expect, it } from "vitest";
import cases from "../../../examples/connection-cycles/cases.json";
import type { AgentSpec, Edge } from "../src/generated/agent_spec";
import { checkConnection } from "../src/graph/connection";
import { translate } from "../src/i18n/messages";

interface CycleCase {
  name: string;
  nodes: string[];
  edges: [string, string][];
  draw: [string, string];
  cycle: boolean;
}

const CASES = cases as CycleCase[];

function router(id: string) {
  return {
    id,
    type: "llm.router",
    position: { x: 0, y: 0 },
    config: { model_ref: "model://default", prompt_ref: "prompt://x@1" },
  };
}

function link([source, target]: [string, string]): Edge {
  return {
    id: `${source}-${target}`,
    kind: "data",
    source: { node: source, port: "passthrough" },
    target: { node: target, port: "input" },
  };
}

function specOf(nodes: string[], edges: [string, string][]): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: "cycle-case",
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: { type: "object" },
    state_schema: { type: "object" },
    nodes: nodes.map(router),
    edges: edges.map(link),
  };
}

/**
 * 순환이라는 이유로 거절했는가 — Python이 `code == "graph.cycle"`을 짚는 것과 같은 엄밀도다.
 * 다른 이유(포트·종류)로 거절한 것은 여기서 같은 판정이 아니다.
 */
function refusesAsACycle(one: CycleCase): boolean {
  const [source, target] = one.draw;
  const check = checkConnection(
    specOf(one.nodes, one.edges),
    { node: source, port: "passthrough" },
    { node: target, port: "input" },
  );
  return !check.ok && check.reason?.key === "connection.cycle";
}

describe("연결 하나가 순환을 만드는가 — 서버와 같은 판정", () => {
  it.each(CASES)("$name", (one) => {
    expect(refusesAsACycle(one)).toBe(one.cycle);
  });

  it("돌아오는 길이 생긴다는 사실을 쉬운 말로 말한다", () => {
    const refused = checkConnection(
      specOf(["a", "b"], [["a", "b"]]),
      { node: "b", port: "passthrough" },
      { node: "a", port: "input" },
    );

    // 노드의 내부 이름은 화면에 쓰지 않는다 — 흐름이 어떻게 되는지만 말한다.
    expect(refused.reason && translate("ko", refused.reason)).toContain("되돌아가");
    expect(refused.reason && translate("ko", refused.reason)).not.toContain("'b'");
    expect(refused.reason && translate("en", refused.reason)).toContain("never end");
  });

  // Python이 반복(iterative) DFS인 이유와 같다 — 긴 체인에서 스택이 터지지 않아야 한다.
  it("아주 긴 줄에서도 스택이 터지지 않는다", () => {
    const ids = Array.from({ length: 5000 }, (_, at) => `n${at}`);
    const edges = ids.slice(1).map((id, at): [string, string] => [ids[at], id]);
    const spec = specOf(ids, edges);

    expect(
      checkConnection(
        spec,
        { node: ids[ids.length - 1], port: "passthrough" },
        { node: ids[0], port: "input" },
      ).ok,
    ).toBe(false);
    expect(
      checkConnection(
        spec,
        { node: ids[0], port: "passthrough" },
        { node: ids[ids.length - 1], port: "input" },
      ).ok,
    ).toBe(true);
  });
});
