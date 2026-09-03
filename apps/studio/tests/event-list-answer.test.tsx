import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { EventList } from "../src/run/EventList";
import { useEditor } from "../src/store/editor";
import type { RunRecord } from "../src/store/runSlice";

const example = exampleSpec as unknown as AgentSpec;
const RUN = "run_answer";
const START = new Date("2026-09-04T12:30:00.000Z");

/** 갈림길 조건이 지워진 판 — 이 판으로 읽으면 갈림길의 봉투까지 답으로 세어진다. */
const withoutWays: AgentSpec = {
  ...example,
  edges: example.edges.map(({ condition: _condition, ...rest }) => rest),
};

function said(nodeId: string, text: string, seq: number, runId = RUN): RunEvent {
  return {
    run_id: runId,
    seq,
    event_type: "llm.completed",
    timestamp: START.toISOString(),
    spec_revision: example.revision,
    node_id: nodeId,
    payload: { text },
  };
}

function closed(event_type: RunEvent["event_type"], seq: number, runId = RUN): RunEvent {
  return {
    run_id: runId,
    seq,
    event_type,
    timestamp: START.toISOString(),
    spec_revision: example.revision,
    payload: { node_count: 3 },
  };
}

function record(id: string, events: RunEvent[], specSnapshot: AgentSpec): RunRecord {
  return { id, at: START, order: 1, events, specSnapshot };
}

function watch(events: RunEvent[], history?: RunRecord[]) {
  act(() => {
    useEditor.setState({
      runEvents: events,
      activeRunId: RUN,
      runOffsetMs: 0,
      runHistory: history ?? [record(RUN, events, example)],
    });
  });
  const { container } = render(<EventList />);
  return {
    container,
    bubble: container.querySelector(".event-list__answer .chat-bubble"),
  };
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("실행이 끝나면 목록 맨 위에 서는 받은 답", () => {
  it("말한 노드가 마지막으로 낸 말을 라벨과 함께 보여 준다", () => {
    const { bubble } = watch([
      said("clinical-agent", "천식이 의심돼요", 0),
      closed("run.completed", 1),
    ]);

    expect(screen.getByText("받은 답")).toBeInTheDocument();
    expect(bubble?.textContent).toBe("천식이 의심돼요");
  });

  it("답 묶음이 사건 목록보다 먼저 온다", () => {
    const { container } = watch([
      said("clinical-agent", "천식이 의심돼요", 0),
      closed("run.completed", 1),
    ]);

    const answer = container.querySelector(".event-list__answer");
    const items = container.querySelector(".event-list__items");
    expect(answer?.compareDocumentPosition(items as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("아직 끝나지 않은 실행에는 서지 않는다", () => {
    const { bubble } = watch([said("clinical-agent", "천식이 의심돼요", 0)]);

    expect(bubble).toBeNull();
    expect(screen.queryByText("받은 답")).not.toBeInTheDocument();
  });

  it("끝났어도 말한 노드가 없으면 없는 답을 지어내지 않는다", () => {
    const { bubble } = watch([closed("run.failed", 0)]);

    expect(bubble).toBeNull();
    expect(screen.queryByText("받은 답")).not.toBeInTheDocument();
  });

  it("빈 말은 답이 아니다 — 빈 말풍선을 세우지 않는다", () => {
    const { bubble } = watch([
      said("clinical-agent", "   ", 0),
      closed("run.completed", 1),
    ]);

    expect(bubble).toBeNull();
    expect(screen.queryByText("받은 답")).not.toBeInTheDocument();
  });

  it("갈림길 노드가 낸 봉투는 답이 아니다", () => {
    const { bubble } = watch([said("triage", "clinical", 0), closed("run.completed", 1)]);

    expect(bubble).toBeNull();
    expect(screen.queryByText("받은 답")).not.toBeInTheDocument();
  });
});

// 답은 그 실행이 실제로 돈 판으로 읽는다 — 뒤에 캔버스를 고쳐도 지난 실행의 답은 그대로다.
describe("답을 읽는 판", () => {
  const events = [
    said("clinical-agent", "천식이 의심돼요", 0),
    said("triage", "clinical", 1),
    closed("run.completed", 2),
  ];

  it("실행 뒤에 캔버스에서 갈림길을 고쳐도 그때의 판으로 읽는다", () => {
    act(() => {
      useEditor.getState().loadSpec(withoutWays);
    });

    const { bubble } = watch(events, [record(RUN, events, example)]);

    expect(bubble?.textContent).toBe("천식이 의심돼요");
  });

  it("기록이 여럿이면 지금 보고 있는 실행의 답만 선다", () => {
    const otherEvents = [
      said("clinical-agent", "다른 실행의 답", 0, "run_other"),
      closed("run.completed", 1, "run_other"),
    ];

    const { bubble } = watch(events, [
      record("run_other", otherEvents, example),
      record(RUN, events, example),
    ]);

    expect(bubble?.textContent).toBe("천식이 의심돼요");
    expect(screen.queryByText("다른 실행의 답")).not.toBeInTheDocument();
  });

  it("기록이 없는 실행이면 답을 지금 캔버스에서 읽지 않는다", () => {
    const { bubble } = watch(events, []);

    expect(bubble).toBeNull();
    expect(screen.queryByText("받은 답")).not.toBeInTheDocument();
  });
});
