// 지금 잡고 있는 포트가 캔버스 위에서 갈 수 있는 자리들 — 하나도 없으면 안내가 나선다 (C5).
// 이을 수 있는지는 여기서 새로 정하지 않는다. checkConnection에게 물을 뿐이다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { landingPorts } from "../src/canvas/landingPorts";
import type { PortAddress } from "../src/canvas/portLink";
import type { AgentSpec } from "../src/generated/agent_spec";

const example = exampleSpec as unknown as AgentSpec;

function held(nodeId: string, portId: string, side: PortAddress["side"]): PortAddress {
  return { nodeId, portId, side };
}

function landings(spec: AgentSpec, from: PortAddress): string[] {
  return landingPorts(spec, from).map((port) => `${port.nodeId}.${port.portId}`);
}

const onlyOneNode: AgentSpec = { ...example, nodes: [example.nodes[0]], edges: [] };

describe("잡고 있는 포트가 갈 수 있는 자리", () => {
  it("받아 줄 수 있는 자리를 모두 찾아낸다", () => {
    expect(landings(example, held("input", "patient_context", "source"))).toContain(
      "triage.input",
    );
  });

  it("제 노드의 포트에는 이을 수 없다", () => {
    expect(landings(example, held("clinical-agent", "response", "source"))).not.toContain(
      "clinical-agent.messages",
    );
  });

  it("혼자 있는 노드에서는 갈 곳이 하나도 없다", () => {
    expect(landings(onlyOneNode, held("input", "question", "source"))).toEqual([]);
  });

  it("받는 자리에서 끌면 보내는 자리들을 찾는다", () => {
    expect(landings(example, held("output", "input", "target"))).toContain(
      "triage.passthrough",
    );
  });

  it("흐름이 되돌아오는 자리는 갈 곳이 아니다", () => {
    // human-gate는 triage에서 흘러온 뒤다 — 거기로 되돌리면 제자리를 돈다.
    expect(landings(example, held("human-gate", "rejected", "source"))).not.toContain(
      "triage.input",
    );
  });

  it("타입이 다른 자리는 갈 곳이 아니다", () => {
    expect(landings(example, held("triage", "route", "source"))).not.toContain(
      "clinical-agent.messages",
    );
  });
});
