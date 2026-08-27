import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EvalDataset } from "../src/generated/eval_dataset";
import type { RunEvent } from "../src/generated/run_event";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function event(event_type: RunEvent["event_type"], seq: number, payload: Record<string, unknown> = {}): RunEvent {
  return {
    event_type,
    payload,
    run_id: "run-failed",
    seq,
    spec_revision: example.revision,
    timestamp: `2026-08-01T12:30:0${seq}.000Z`,
  };
}

function record(events: RunEvent[], specSnapshot: AgentSpec = example) {
  return {
    id: events[0]?.run_id ?? "run-failed",
    at: new Date("2026-08-01T12:30:00.000Z"),
    order: 1,
    events,
    specSnapshot,
  };
}

function reset() {
  setLocale("ko");
  useEditor.setState({
    runEvents: [],
    runHistory: [],
    activeRunId: null,
    compareSelection: [],
    caseDraft: null,
    evalPanelOpen: false,
    dataset: null,
    datasetSynced: null,
    datasetKnownOnServer: false,
  });
  store().loadSpec(example);
  useEditor.setState({ fetchDataset: async () => ({ notFound: true }) });
}

function failedRun(input: Record<string, unknown> = { question: "hello", nested: { count: 2 } }) {
  return record([
    event("run.started", 1, { input }),
    event("run.failed", 2, { reason: "provider_error" }),
  ]);
}

beforeEach(reset);

describe("failed-run promotion", () => {
  it("promotes only a terminal run.failed record", () => {
    const failed = failedRun();
    const completed = record([
      event("run.started", 1),
      event("run.completed", 2),
    ]);
    useEditor.setState({
      runHistory: [failed, completed],
      runEvents: failed.events,
      activeRunId: failed.id,
      compareSelection: [failed.id, completed.id],
    });

    store().promoteFailedRun(failed.id);

    expect(store().caseDraft).toMatchObject({
      title: "실패한 실행에서 시작",
      input: { question: "hello", nested: { count: 2 } },
      expectedText: "",
    });
    expect(store().evalPanelOpen).toBe(true);
    expect(store().runEvents).toEqual([]);
    expect(store().activeRunId).toBeNull();
    expect(store().compareSelection).toEqual([]);
    expect(store().caseDraft?.input).not.toBe(failed.events[0].payload.input);

    reset();
    useEditor.setState({ runHistory: [completed] });
    store().promoteFailedRun(completed.id);
    expect(store().caseDraft).toBeNull();
    expect(store().evalPanelOpen).toBe(false);
  });

  it("rejects records from another current spec identity", () => {
    const otherSpec = { ...example, id: "another-agent" };
    const failed = failedRun();
    useEditor.setState({ runHistory: [record(failed.events, otherSpec)] });

    store().promoteFailedRun(failed.id);

    expect(store().caseDraft).toBeNull();
    expect(store().evalPanelOpen).toBe(false);
  });

  it("does not overwrite an existing case draft", () => {
    const existing = {
      id: null,
      title: "내 초안",
      input: { keep: true },
      expectedText: "기대 문구",
      runsPerCase: 1,
      passesNeeded: 1,
    };
    const failed = failedRun();
    useEditor.setState({ caseDraft: existing, runHistory: [failed] });

    store().promoteFailedRun(failed.id);

    expect(store().caseDraft).toEqual(existing);
    expect(store().runEvents).toEqual([]);
  });

  it("keeps the seeded draft when a dataset GET resolves late", async () => {
    let resolve!: (outcome: { dataset: EvalDataset }) => void;
    useEditor.setState({
      fetchDataset: () => new Promise((done) => {
        resolve = done;
      }),
    });
    const failed = failedRun({ question: "late", list: ["a", { ok: true }] });
    useEditor.setState({ runHistory: [failed], runEvents: failed.events, activeRunId: failed.id });

    store().promoteFailedRun(failed.id);
    const seeded = store().caseDraft;
    expect(seeded).toMatchObject({ title: "실패한 실행에서 시작", input: { question: "late" } });

    resolve({ dataset: { id: "dataset-1", name: "현재 시험", cases: [] } });
    await Promise.resolve();

    expect(store().dataset?.id).toBe("dataset-1");
    expect(store().caseDraft).toEqual(seeded);
  });
});
