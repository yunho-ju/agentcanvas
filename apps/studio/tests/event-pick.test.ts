// 목록에서 누른 줄이 현재 항목이다 (DESIGN §7 event-list — 현재 항목은 두 손 중 나중 것이 정한다).
// 같은 시각의 사건이 여럿이면 시각만으로는 누른 줄을 되찾을 수 없다: 누른 줄은 따로 기억한다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";
import type { RunRecord } from "../src/store/runSlice";

const example = exampleSpec as unknown as AgentSpec;
const START = new Date("2026-08-01T12:30:00.000Z").getTime();

function store() {
  return useEditor.getState();
}

function eventAt(
  seq: number,
  offsetMs: number,
  event_type: RunEvent["event_type"],
  node_id?: string,
): RunEvent {
  return {
    seq,
    run_id: "run_tied",
    event_type,
    timestamp: new Date(START + offsetMs).toISOString(),
    spec_revision: example.revision,
    ...(node_id ? { node_id } : {}),
    payload: {},
  };
}

/** 1초 안에 끝난 실행 — 가운데 세 사건의 시각이 똑같다. */
const tiedEvents: RunEvent[] = [
  eventAt(0, 0, "run.started"),
  eventAt(1, 100, "node.started", "input"),
  eventAt(2, 100, "node.completed", "input"),
  eventAt(3, 100, "node.started", "triage"),
  eventAt(4, 200, "run.completed"),
];

/** 다른 실행 — 같은 순번(2)이 여기에도 있다. 지난 실행에서 누른 줄이 따라오면 여기서 드러난다. */
const otherEvents: RunEvent[] = [
  eventAt(0, 0, "run.started"),
  eventAt(1, 100, "node.started", "triage"),
  eventAt(2, 200, "run.completed"),
].map((event) => ({ ...event, run_id: "run_other" }));

function record(id: string, events: RunEvent[]): RunRecord {
  return { id, at: new Date(START), order: 1, events, specSnapshot: example };
}

beforeEach(() => {
  store().loadSpec(example);
  useEditor.setState({
    runEvents: tiedEvents,
    runOffsetMs: 0,
    activeRunId: "run_tied",
    runHistory: [record("run_tied", tiedEvents), record("run_other", otherEvents)],
  });
});

describe("같은 시각의 사건 셋 중 가운데를 누르면", () => {
  it("누른 그 줄이 현재 항목이다 — 같은 시각의 마지막 사건이 아니다", () => {
    store().goToEvent(2);

    expect(currentSeq(store())).toBe(2);
  });

  it("그 사건을 한 노드를 함께 고른다", () => {
    store().goToEvent(2);

    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "input",
    ]);
  });

  it("재생 위치도 그 사건의 시각으로 간다", () => {
    store().goToEvent(2);

    expect(store().runOffsetMs).toBe(100);
  });
});

describe("누른 줄을 놓는 때", () => {
  it("다시 재생하면 그때부터는 시각이 현재 항목을 정한다", () => {
    store().goToEvent(2);

    store().playRun();
    store().tickRun(50);

    expect(currentSeq(store())).toBe(3);
  });

  it("스크럽하면 누른 줄은 사라진다", () => {
    store().goToEvent(2);

    store().scrubToSeq(4);

    expect(currentSeq(store())).toBe(4);
  });

  it("처음부터 다시 보면 누른 줄은 사라진다", () => {
    store().goToEvent(2);

    store().restartRun();

    expect(currentSeq(store())).toBe(0);
  });

  it("다른 실행을 열면 누른 줄은 따라오지 않는다", () => {
    store().goToEvent(2);

    store().replayRun("run_other");

    expect(currentSeq(store())).toBe(0);
  });
});
