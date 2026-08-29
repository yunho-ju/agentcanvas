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

// 도구가 진짜로 일하기 시작했다 (API_TOOLS P3a) — 목록은 그 세 걸음을 쉬운 말로 말한다.
describe("도구가 일한 자리를 읽는 말", () => {
  function toolEvent(
    event_type: EventType,
    payload: Record<string, unknown>,
  ): RunEvent {
    return { ...events[0], event_type, node_id: "lookup", payload };
  }

  const asked = {
    node_id: "lookup",
    resource_ref: "clinical-reference",
    tool_name: "search_article",
  };

  function said(event: RunEvent, locale: Locale = "ko"): string {
    return translate(locale, eventSummary(event));
  }

  it("도구를 써도 되는지 확인한 걸음을 말한다", () => {
    const checked = toolEvent("tool.policy_checked", { ...asked, allowed: true });

    expect(said(checked)).toContain("lookup");
    expect(said(checked, "en")).not.toMatch(/[가-힣]/);
  });

  it("허락하지 않는 도구였음을 그 자리에서 말한다", () => {
    const refused = toolEvent("tool.policy_checked", { ...asked, allowed: false });

    expect(said(refused)).not.toBe(
      said(toolEvent("tool.policy_checked", { ...asked, allowed: true })),
    );
    expect(said(refused)).toContain("search_article");
  });

  it("무엇을 불렀는지 도구 이름으로 말한다", () => {
    const requested = toolEvent("tool.requested", { ...asked, input: { q: "a" } });

    expect(said(requested)).toContain("search_article");
  });

  it("받아 온 것이 얼마였고 얼마를 실었는지 말한다", () => {
    const completed = toolEvent("tool.completed", {
      ...asked,
      ok: true,
      result: { articles: [] },
      original_chars: 120,
      loaded_chars: 120,
    });

    expect(said(completed)).toContain("120");
    for (const locale of ["ko", "en"] as const) {
      expect(said(completed, locale).trim()).not.toBe("");
    }
  });

  it("sections로 줄여 실은 답은 두 수가 실제로 갈려 보인다 (API_TOOLS P3c)", () => {
    const trimmed = toolEvent("tool.completed", {
      ...asked,
      ok: true,
      result: { diagnosis: {} },
      original_chars: 12400,
      loaded_chars: 780,
      sections: ["diagnosis"],
    });

    // 원문과 실은 것이 다른 수로 나란히 보인다 — 실제 절감을 사람이 읽는다.
    expect(said(trimmed)).toContain("12400");
    expect(said(trimmed)).toContain("780");
  });

  it("retrieve로 골라 실은 답도 같은 렌더로 절감을 보인다 (API_TOOLS P3d)", () => {
    // retrieve의 payload는 sections와 다르지만(query·retrieved) 요약 줄은 같은 두 수만 읽는다.
    const picked = toolEvent("tool.completed", {
      ...asked,
      ok: true,
      result: { diagnosis: "asthma..." },
      original_chars: 9000,
      loaded_chars: 420,
      query: "asthma cough",
      retrieved: [{ chunk: "diagnosis", score: 3.1 }],
    });

    expect(said(picked)).toContain("9000");
    expect(said(picked)).toContain("420");
  });

  it("도구가 일을 마치지 못한 자리는 그렇게 말하고 다음 걸음을 알려준다", () => {
    const failed = toolEvent("tool.completed", {
      ...asked,
      ok: false,
      error: { reason: "timeout", message: "waited too long" },
      original_chars: 0,
      loaded_chars: 0,
    });

    expect(said(failed)).not.toContain("120");
    expect(said(failed)).toMatch(/기다렸는데|시간/);
    // 서버가 실은 영어 원문은 화면의 글이 아니다.
    expect(said(failed)).not.toContain("waited too long");
    expect(said(failed, "en")).not.toMatch(/[가-힣]/);
  });

  it("모르는 갈래로 어그러져도 조용히 넘기지 않는다", () => {
    const strange = toolEvent("tool.completed", {
      ...asked,
      ok: false,
      error: { reason: "sunspots", message: "?" },
    });

    expect(said(strange).trim()).not.toBe("");
    expect(said(strange)).not.toContain("sunspots");
  });

  it("도구를 부르기 전 사람 확인 요청은 어느 도구인지 말한다", () => {
    const asking = toolEvent("human.approval_requested", asked);
    const gate = toolEvent("human.approval_requested", { approval_schema_ref: "s" });

    // 도구 승인은 밸브 승인과 다른 말이다 — 무엇을 승인하는지(도구 이름)를 말한다.
    expect(said(asking)).toContain("search_article");
    expect(said(asking)).not.toBe(said(gate));
    expect(said(asking, "en")).not.toMatch(/[가-힣]/);
  });
});
