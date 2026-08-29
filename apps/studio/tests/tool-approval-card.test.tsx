// 도구를 부르기 전 사람 확인 카드 (API_TOOLS P3b) — 기존 gate-card 문법을 그대로 쓴다.
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentSpec } from "../src/generated/agent_spec";
import { GateCard } from "../src/run/GateCard";
import { useEditor } from "../src/store/editor";

function store() {
  return useEditor.getState();
}

const TOOL = "lookup";

/** 도구 노드 하나(ask_first)만 있는 작은 문서. */
function specWithAskFirstTool(): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: "ask-first",
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: { type: "object", properties: {} },
    state_schema: { type: "object", properties: {} },
    resources: [
      {
        id: "billing-api",
        kind: "http.api",
        server_ref: "api://billing-api",
        allowed_tools: [],
        approval_policy: "ask_first",
        tools: [
          {
            name: "charge_card",
            plain_description: {
              ko: "카드에서 돈을 청구한다.",
              en: "Charges money from the card.",
            },
            input_schema: { type: "object", properties: {} },
            output_schema: { type: "object" },
            timeout_ms: 8000,
            call: {
              transport: "http",
              method: "POST",
              url_template: "https://api.example.com/charge",
            },
          },
        ],
      },
    ],
    nodes: [
      {
        id: TOOL,
        type: "tool.mcp",
        position: { x: 0, y: 0 },
        config: { resource_ref: "billing-api", tool_name: "charge_card" },
      },
    ],
    edges: [],
  } as unknown as AgentSpec;
}

/** 도구를 부르기 전 멈춰 선 실행 이벤트 — 승인 payload에 어느 도구인지 실려 있다. */
function pausedBeforeTheTool() {
  const base = {
    run_id: "run_1",
    timestamp: "2026-08-01T12:30:00.000Z",
    spec_revision: `sha256:${"0".repeat(64)}`,
    node_id: TOOL,
  };
  return [
    { ...base, seq: 0, event_type: "run.started", node_id: null, payload: {} },
    { ...base, seq: 1, event_type: "node.started", payload: { node_type: "tool.mcp" } },
    {
      ...base,
      seq: 2,
      event_type: "tool.policy_checked",
      payload: {
        node_id: TOOL,
        resource_ref: "billing-api",
        tool_name: "charge_card",
        allowed: true,
      },
    },
    {
      ...base,
      seq: 3,
      event_type: "human.approval_requested",
      payload: { node_id: TOOL, resource_ref: "billing-api", tool_name: "charge_card" },
    },
    { ...base, seq: 4, event_type: "run.paused", payload: { waiting_for: TOOL } },
  ];
}

beforeEach(() => {
  store().loadSpec(specWithAskFirstTool());
  act(() => {
    useEditor.setState({
      runEvents: pausedBeforeTheTool() as never,
      activeRunId: "run_1",
      runOffsetMs: 10_000,
      gateCardOpen: true,
    });
  });
});

describe("도구를 부르기 전 사람 확인 카드", () => {
  it("무엇을 승인하는지 도구 이름과 쉬운 설명으로 묻는다", () => {
    render(<GateCard nodeId={TOOL} />);

    const card = screen.getByRole("dialog");
    expect(within(card).getByText(/charge_card/)).toBeInTheDocument();
    expect(within(card).getByText("카드에서 돈을 청구한다.")).toBeInTheDocument();
  });

  it("허락과 멈추기 두 길을 준다 — 기존 gate-card 버튼 그대로", () => {
    render(<GateCard nodeId={TOOL} />);

    const card = screen.getByRole("dialog");
    expect(within(card).getByRole("button", { name: "승인하고 계속" })).toBeEnabled();
  });
});
