import { describe, expect, it } from "vitest";
import runEventSchema from "../../../packages/contracts/json_schema/run_event.json";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EventType, RunEvent } from "../src/generated/run_event";
import { eventSummary, payloadLines } from "../src/run/eventWords";
import type { Locale } from "../src/i18n/locale";
import { translate } from "../src/i18n/messages";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";

const example = exampleSpec as unknown as AgentSpec;
// 예시 그래프는 사람 확인 밸브에서 한 번 멈춘다 — 끝까지 간 실행이라야 모든 종류의 사건이 나온다.
const options = {
  runId: "run_example",
  startedAt: new Date("2026-08-01T12:30:00.000Z"),
};
const events = resumeFakeRun(example, fakeRun(example, options), { approved: true });

const CONTRACT_EVENT_TYPES = runEventSchema.$defs.EventType.enum as EventType[];

function summaryOf(type: EventType, nodeId?: string, locale: Locale = "ko"): string {
  const event = events.find(
    (candidate) =>
      candidate.event_type === type && (!nodeId || candidate.node_id === nodeId),
  );
  if (!event) throw new Error(`the example run has no ${type} event`);
  return translate(locale, eventSummary(event));
}

function anyEventOf(event_type: EventType): RunEvent {
  return { ...events[0], event_type, node_id: "triage" };
}

describe("telling the user what happened, in plain words", () => {
  it("says the run began", () => {
    expect(summaryOf("run.started")).toBe("실행을 시작했다");
  });

  it("names the node that started working", () => {
    expect(summaryOf("node.started", "triage")).toBe("'triage' 노드가 일을 시작했다");
  });

  it("says a node is waiting for its turn", () => {
    expect(summaryOf("node.queued", "triage")).toBe("'triage' 노드가 차례를 기다린다");
  });

  it("says a node finished", () => {
    expect(summaryOf("node.completed", "triage")).toBe("'triage' 노드가 일을 마쳤다");
  });

  it("says where a value went when it crossed a connection", () => {
    // 이름 뒤에 붙는 조사가 이름마다 달라지지 않는 말투를 쓴다 ('triage이/가' 문제를 피한다).
    expect(summaryOf("state.patch")).toBe(
      "'triage'에서 만든 값이 'clinical-agent'로 넘어갔다",
    );
  });

  it("says the run ended", () => {
    expect(summaryOf("run.completed")).toBe("실행을 모두 마쳤다");
  });

  it("can say every event the contract allows", () => {
    const said = CONTRACT_EVENT_TYPES.map((type) =>
      translate("ko", eventSummary(anyEventOf(type))),
    );

    expect(said.filter((sentence) => sentence.trim() === "")).toEqual([]);
    expect(new Set(said).size).toBe(CONTRACT_EVENT_TYPES.length);
  });

  it("can say every event in english too", () => {
    const said = CONTRACT_EVENT_TYPES.map((type) =>
      translate("en", eventSummary(anyEventOf(type))),
    );

    expect(said.filter((sentence) => sentence.trim() === "")).toEqual([]);
    expect(new Set(said).size).toBe(CONTRACT_EVENT_TYPES.length);
    expect(said.join(" ")).not.toMatch(/[가-힣]/);
  });

  it("keeps technical words out of the english sentences too", () => {
    const said = CONTRACT_EVENT_TYPES.map((type) =>
      translate("en", eventSummary(anyEventOf(type))),
    ).join(" ");

    expect(said).not.toMatch(/payload|seq|patch|schema|LLM|prompt|token|event/i);
  });

  it("names the node that started working, in english", () => {
    expect(summaryOf("node.started", "triage", "en")).toBe(
      "The 'triage' node started working",
    );
  });

  it("does not say the run picked up again when the person said no", () => {
    const refused = resumeFakeRun(example, fakeRun(example, options), { approved: false });
    const answered = refused.find((event) => event.event_type === "run.resumed");

    expect(translate("ko", eventSummary(answered ?? events[0]))).toBe("사람이 거절했다");
    expect(translate("en", eventSummary(answered ?? events[0]))).toBe(
      "A person turned it down",
    );
  });

  it("still says the run picked up again when the person approved", () => {
    expect(summaryOf("run.resumed")).toBe("멈췄던 실행을 이어서 한다");
  });

  it("says a person turned it down and the flow ended there", () => {
    const refused = resumeFakeRun(example, fakeRun(example, options), { approved: false });
    const finished = refused
      .filter(
        (event) => event.node_id === "human-gate" && event.event_type === "node.completed",
      )
      .at(-1);

    expect(translate("ko", eventSummary(finished ?? events[0]))).toBe(
      "사람이 거절해서 흐름을 여기서 마쳤다",
    );
    expect(translate("en", eventSummary(finished ?? events[0]))).toBe(
      "A person turned it down, so the run ended here",
    );
  });

  it("shows what the event carried, one line for each thing", () => {
    const asked = events.find((event) => event.event_type === "llm.requested");

    expect(payloadLines(asked ?? events[0])).toEqual(['model_ref: "model://default"']);
  });

  it("has nothing to show for an event that carried nothing", () => {
    expect(payloadLines({ ...events[0], payload: {} })).toEqual([]);
  });

  it("cuts a long value short so the list stays readable", () => {
    const long = { ...events[0], payload: { note: "가".repeat(200) } };

    expect(payloadLines(long)[0].length).toBeLessThan(90);
    expect(payloadLines(long)[0]).toMatch(/…$/);
  });

  it("keeps technical words out of every sentence", () => {
    const said = CONTRACT_EVENT_TYPES.map((type) =>
      translate("ko", eventSummary(anyEventOf(type))),
    ).join(" ");

    expect(said).not.toMatch(/payload|seq|patch|schema|LLM|prompt|token|event/i);
  });
});
