// 고칠 자리를 파생하는 규칙 (M1~M6) — 쌓인 이벤트만 보고, 매번 다시 읽는다.
// 새 판정 뿌리는 없다: 멈춤은 서버의 run_status, 도구 실패는 tool.completed의 ok,
// 말의 끝은 실시간 대화와 같은 chatTurnEnd가 읽는다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { ThreadStatus, ThreadTurn } from "../src/api/threads";
import { fixSpotsIn } from "../src/chat/fixSpots";
import { fixSpotHint, fixSpotSummary, fixSpotWords } from "../src/chat/fixSpotWords";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { msg, translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

function graphTaking(...names: string[]): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.type === "core.input"
        ? {
            ...node,
            config: {
              bindings: Object.fromEntries(names.map((name) => [name, `input.${name}`])),
            },
          }
        : node,
    ),
  } as AgentSpec;
}

const spec = graphTaking("message");

let seq = 0;

function event(
  event_type: RunEvent["event_type"],
  payload: Record<string, unknown> = {},
  nodeId?: string,
  runId = "run_1",
): RunEvent {
  seq += 1;
  return {
    event_type,
    payload,
    run_id: runId,
    seq,
    spec_revision: example.revision,
    timestamp: "2026-08-01T12:30:00Z",
    ...(nodeId ? { node_id: nodeId } : {}),
  };
}

function turn(runId: string, events: RunEvent[]): ThreadTurn {
  return {
    run: {
      id: runId,
      spec_id: example.id,
      spec_revision: example.revision,
      created_at: "2026-08-01T12:30:00Z",
      thread_id: "run_1",
    },
    events,
  };
}

/** 말 한 번이 답까지 갔다 — 조용한 성공이다. */
function answered(runId: string): ThreadTurn {
  return turn(runId, [
    event("run.started", { input: { message: "안녕" } }, undefined, runId),
    event("llm.completed", { text: "반가워요" }, "clinical-agent", runId),
    event("run.completed", {}, undefined, runId),
  ]);
}

/** 답하는 노드가 아무 말도 남기지 않고 끝난 말 한 번. */
function silent(runId: string): ThreadTurn {
  return turn(runId, [
    event("run.started", { input: { message: "안녕" } }, undefined, runId),
    event("run.completed", {}, undefined, runId),
  ]);
}

function spots(status: ThreadStatus, turns: ThreadTurn[]) {
  return fixSpotsIn(spec, status, turns);
}

function kinds(status: ThreadStatus, turns: ThreadTurn[]): string[] {
  return spots(status, turns).map((spot) => spot.kind);
}

describe("밸브에 걸린 자리 (M1)", () => {
  it("사람 확인을 기다리다 멈춘 대화는 그 자리를 말한다", () => {
    const held = turn("run_1", [
      event("run.started", { input: { message: "안녕" } }),
      event("human.approval_requested", {}, "human-gate"),
      event("run.paused", { waiting_for: "human-gate" }, "human-gate"),
    ]);

    expect(kinds("paused", [held])).toContain("heldForCheck");
  });

  it("멈추지 않은 대화에는 그 자리가 없다", () => {
    expect(kinds("completed", [answered("run_1")])).not.toContain("heldForCheck");
  });
});

describe("도구가 실패한 자리 (M2)", () => {
  const fellShort = (reason: unknown) =>
    turn("run_1", [
      event("run.started", { input: { message: "안녕" } }),
      event(
        "tool.completed",
        {
          resource_ref: "pubmed",
          tool_name: "search",
          ok: false,
          error: { reason, message: "connection reset by peer" },
        },
        "clinical-agent",
      ),
      event("llm.completed", { text: "반가워요" }, "clinical-agent"),
      event("run.completed", {}),
    ]);

  it("어느 연결·어느 도구·무슨 갈래인지 말한다", () => {
    expect(spots("completed", [fellShort("timeout")])).toContainEqual({
      kind: "toolFailed",
      resource: "pubmed",
      tool: "search",
      trouble: "timeout",
    });
  });

  it("모르는 갈래는 갈래를 지어내지 않는다 — 일반 문구로 말한다", () => {
    const found = spots("completed", [fellShort("moon_phase")]);

    expect(found).toContainEqual({
      kind: "toolFailed",
      resource: "pubmed",
      tool: "search",
      trouble: null,
    });
    const badge = translate("ko", fixSpotWords(found[0]));
    expect(badge).not.toContain("moon_phase");
    expect(badge).toContain(translate("ko", msg("event.tool.trouble")));
  });

  it("서버가 함께 보낸 원문은 화면의 글이 되지 않는다", () => {
    const found = spots("completed", [fellShort("http_error")]);
    const said = `${translate("ko", fixSpotWords(found[0]))} ${translate("ko", fixSpotHint(found[0]))}`;

    expect(said).not.toContain("connection reset by peer");
    expect(said).not.toContain("http_error");
  });

  // DESIGN §7 chat-panel: 뱃지 ②는 '{연결}의 {도구}가 답을 못 가져왔어요' + 갈래별 다음 걸음이다.
  it("연결·도구·다음 걸음은 상시 보이는 문구다 — title에 숨기지 않는다", () => {
    const badge = translate("ko", fixSpotWords(spots("completed", [fellShort("timeout")])[0]));

    expect(badge).toContain("pubmed");
    expect(badge).toContain("search");
    expect(badge).toContain(translate("ko", msg("event.tool.trouble.timeout")));
  });

  it("갈래를 옮기는 사전은 실행 화면의 것 하나다 — 두 벌로 만들지 않는다 (m9)", () => {
    const badge = translate("ko", fixSpotWords(spots("completed", [fellShort("bad_output")])[0]));

    expect(badge).toContain(translate("ko", msg("event.tool.trouble.bad_output")));
  });

  it("도구가 답을 가져온 대화는 조용하다", () => {
    expect(kinds("completed", [answered("run_1")])).not.toContain("toolFailed");
  });
});

describe("끝내지 못한 대화와 그만둔 대화 (M3)", () => {
  const brokeDown = turn("run_1", [
    event("run.started", { input: { message: "안녕" } }),
    event("run.failed", { reason: "provider_error", message: "boom" }),
  ]);

  const stopped = turn("run_1", [
    event("run.started", { input: { message: "안녕" } }),
    event("run.failed", { reason: "cancelled", message: "this run was cancelled" }),
  ]);

  it("마지막 말이 실패로 끝나면 끝내지 못한 대화다", () => {
    expect(kinds("failed", [brokeDown])).toContain("unfinished");
  });

  it("마지막 말이 아무 답도 없이 끝나도 끝내지 못한 대화다", () => {
    expect(kinds("completed", [silent("run_1")])).toContain("unfinished");
  });

  it("사람이 그만둔 대화는 실패로 뭉뚱그리지 않는다", () => {
    expect(kinds("failed", [stopped])).toContain("abandoned");
    expect(kinds("failed", [stopped])).not.toContain("unfinished");
  });

  it("그만둔 대화와 끝내지 못한 대화는 다른 말을 한다", () => {
    const [gaveUp] = spots("failed", [stopped]);
    const [broke] = spots("failed", [brokeDown]);

    expect(translate("ko", fixSpotWords(gaveUp))).not.toBe(
      translate("ko", fixSpotWords(broke)),
    );
    expect(translate("ko", fixSpotWords(broke))).not.toContain("boom");
  });

  it("아직 돌고 있는 말은 끝내지 못했다고 말하지 않는다 — 끝나지 않은 것은 아직 사실이 아니다", () => {
    const going = turn("run_1", [event("run.started", { input: { message: "안녕" } })]);

    expect(kinds("running", [going])).toEqual([]);
  });
});

describe("사람이 되물은 자리 (M4)", () => {
  it("답을 받지 못한 말 뒤에 또 말했으면 그 자리를 말한다", () => {
    expect(kinds("completed", [silent("run_1"), answered("run_2")])).toContain("askedAgain");
  });

  it("답을 받은 뒤에 이어 말한 것은 되물은 자리가 아니다", () => {
    expect(kinds("completed", [answered("run_1"), answered("run_2")])).not.toContain(
      "askedAgain",
    );
  });

  it("마지막 말이 답을 못 받은 것은 되물은 자리가 아니다 — 다시 말한 적이 없다", () => {
    expect(kinds("completed", [answered("run_1"), silent("run_2")])).not.toContain(
      "askedAgain",
    );
  });

  it("같은 질문을 반복했다고 주장하지 않는다 — 정의대로 말한다", () => {
    const [again] = spots("completed", [silent("run_1"), answered("run_2")]).filter(
      (spot) => spot.kind === "askedAgain",
    );

    expect(translate("ko", fixSpotWords(again))).toContain("다시 말");
    expect(translate("ko", fixSpotWords(again))).not.toContain("같은 질문");
  });
});

describe("조용한 성공 (M5·M6)", () => {
  it("문제없는 대화에는 고칠 자리가 하나도 없다 — 없는 문제를 만들지 않는다", () => {
    expect(spots("completed", [answered("run_1"), answered("run_2")])).toEqual([]);
  });

  it("같은 이벤트를 두 번 읽어도 같은 답이다 (순수 함수)", () => {
    const turns = [silent("run_1"), answered("run_2")];

    expect(spots("completed", turns)).toEqual(spots("completed", turns));
  });

  it("한 대화에서 여러 자리가 나오면 모두 말한다", () => {
    const messy = turn("run_1", [
      event("run.started", { input: { message: "안녕" } }),
      event(
        "tool.completed",
        { resource_ref: "pubmed", tool_name: "search", ok: false, error: { reason: "timeout" } },
        "clinical-agent",
      ),
      event("run.completed", {}),
    ]);

    expect(kinds("completed", [messy])).toEqual(["toolFailed", "unfinished"]);
  });

  it("영어로도 빈 말이 되지 않는다", () => {
    for (const spot of spots("paused", [silent("run_1"), silent("run_2")])) {
      expect(translate("en", fixSpotWords(spot))).not.toBe("");
      expect(translate("en", fixSpotHint(spot))).not.toBe("");
    }
  });

  it("뱃지는 점수도 백분율도 말하지 않는다 (요약 pill 규율)", () => {
    const many = spots("paused", [
      turn("run_1", [
        event("run.started", { input: { message: "안녕" } }),
        event(
          "tool.completed",
          { resource_ref: "pubmed", tool_name: "search", ok: false, error: { reason: "timeout" } },
          "clinical-agent",
        ),
        event("run.paused", {}, "human-gate"),
      ]),
    ]);

    for (const spot of many) {
      expect(translate("ko", fixSpotWords(spot))).not.toMatch(/[%０-９]|\d/);
    }
  });
});

describe("목록 위 요약 줄 (M2 — 결론이 먼저, 숫자 금지)", () => {
  it("어떤 갈래의 자리가 있는지 쉬운 말로 한 줄에 모은다", () => {
    const line = fixSpotSummary(
      [
        { kind: "heldForCheck" },
        { kind: "unfinished" },
        { kind: "unfinished" },
      ],
      "ko",
    );

    expect(line).not.toBeNull();
    expect(line).toContain("확인을 기다리다 멈춤");
    expect(line).toContain("끝내지 못한 대화");
    // 같은 갈래를 두 번 세지 않는다 — 개수가 아니라 무엇이 있는지를 말한다.
    expect(line?.match(/끝내지 못한 대화/g)).toHaveLength(1);
  });

  it("개수도 백분율도 말하지 않는다", () => {
    const line = fixSpotSummary([{ kind: "unfinished" }, { kind: "abandoned" }], "ko") ?? "";

    expect(line).not.toMatch(/\d/);
    expect(line).not.toContain("%");
  });

  it("고칠 자리가 없으면 요약 줄도 없다 — 빈 줄을 세우지 않는다", () => {
    expect(fixSpotSummary([], "ko")).toBeNull();
  });

  it("영어로도 빈 말이 되지 않는다", () => {
    expect(fixSpotSummary([{ kind: "askedAgain" }], "en")).not.toBe("");
  });
});
