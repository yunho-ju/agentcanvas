// 서버가 말한 모양을 화면이 읽는 규칙 — 팔레트는 짧은 이름과 대가만이 아니라
// 그 모양을 문서에 놓는 템플릿까지 읽는다. 어긋난 답은 아는 척하지 않는다(null).
import { describe, expect, it } from "vitest";
import {
  type PatternChoice,
  serverPatternsOf,
  thisScreenCanDraw,
} from "../src/registry/patternCatalog";

const GATE = {
  id: "human_gate",
  short_name: { ko: "사람이 확인하고 넘어가기", en: "Ask a person first" },
  question: { ko: "물음", en: "question" },
  applies_when: { ko: "언제", en: "when" },
  cost: { ko: "실행이 사람 확인에서 멈춰 기다려요", en: "The run waits for a person" },
  needs: ["human_gate"],
  template: [
    {
      op: "add_node",
      node: "{new:gate}",
      type: "control.human_gate",
      config: { approval_schema_ref: "schema://answer-review@1" },
    },
    { op: "remove_edge", source: "{agent}", target: "{output}" },
    {
      op: "add_edge",
      kind: "approval",
      source: { node: "{agent}", port: "response" },
      target: { node: "{new:gate}", port: "review" },
    },
  ],
  detects: "acts_without_a_person",
};

function read(pattern: unknown) {
  return serverPatternsOf({ patterns: [pattern] });
}

/** 이 서버가 더 새로울 수 있다 — 못 읽는 줄 하나가 나머지를 지우면 안 된다. */
function readBeside(stranger: unknown) {
  return serverPatternsOf({ patterns: [stranger, GATE] });
}

describe("serverPatternsOf — 팔레트가 읽는 모양", () => {
  it("짧은 이름·대가·템플릿을 그대로 싣는다", () => {
    expect(read(GATE)).toEqual([
      {
        id: "human_gate",
        shortName: GATE.short_name,
        cost: GATE.cost,
        needs: GATE.needs,
        template: GATE.template,
      },
    ]);
  });

  it("대가를 말하지 않는 모양은 읽지 않는다 — 값 없이 권하지 않는다", () => {
    expect(read({ ...GATE, cost: { ko: "대가" } })).toEqual([]);
  });

  it("이 서버가 무엇을 갖춰야 하는지 어긋나게 말하면 읽지 않는다", () => {
    expect(read({ ...GATE, needs: ["telepathy"] })).toEqual([]);
  });

  it("모르는 작업이 섞인 템플릿은 읽지 않는다 — 반만 놓지 않는다", () => {
    expect(read({ ...GATE, template: [{ op: "rename_node", node: "{agent}" }] })).toEqual([]);
  });

  // 표를 물려받은 이름으로 뒤져도 아는 작업이 되지 않는다 (Object.prototype의 것은 표의 것이 아니다).
  it("물려받은 이름을 작업 이름이라 말해도 읽지 않는다", () => {
    expect(read({ ...GATE, template: [{ op: "constructor", node: "{agent}" }] })).toEqual([]);
  });

  it("앵커 이름이 규칙에 어긋나면 읽지 않는다", () => {
    expect(read({ ...GATE, template: [{ op: "requires_tools", node: "agent" }] })).toEqual([]);
  });

  it("연결 작업이 양 끝을 다 말하지 않으면 읽지 않는다", () => {
    expect(
      read({
        ...GATE,
        template: [
          { op: "add_edge", kind: "data", source: { node: "{agent}", port: "response" } },
        ],
      }),
    ).toEqual([]);
  });

  // 서버가 이 화면보다 새로울 수 있다 — 못 읽는 줄 하나가 목록 전체를 지우면
  // 이미 서 있던 자리(고치기 패널의 칩)까지 이름을 잃는다.
  it("못 읽는 줄은 건너뛰고 나머지는 그대로 세운다", () => {
    expect(readBeside({ id: "telepathy", short_name: { ko: "?", en: "?" } })).toEqual([
      {
        id: "human_gate",
        shortName: GATE.short_name,
        cost: GATE.cost,
        needs: GATE.needs,
        template: GATE.template,
      },
    ]);
  });

  it("모양 목록 자체가 어긋나면 그때는 모른다고 한다", () => {
    expect(serverPatternsOf({ patterns: "soon" })).toBeNull();
  });
});

// 이 화면이 그릴 수 있는 모양만 줄이 된다 — 반만 놓이느니 서지 않는다.
describe("thisScreenCanDraw — 이 build가 그릴 수 있는 모양인가", () => {
  const drawable = (template: unknown[]) =>
    thisScreenCanDraw({
      id: "x",
      shortName: GATE.short_name,
      cost: GATE.cost,
      needs: [],
      template: template as PatternChoice["template"],
    });

  it("카탈로그의 모양은 그린다", () => {
    expect(drawable(GATE.template)).toBe(true);
  });

  it("이 registry에 없는 단계를 놓는 모양은 그리지 못한다", () => {
    expect(
      drawable([
        { op: "add_node", node: "{new:x}", type: "control.telepathy", config: {} },
      ]),
    ).toBe(false);
  });

  // 없는 손잡이로 그은 선은 화면에 아무 데도 닿지 않는다 — 놓기 전에 안다.
  it("이 registry에 없는 포트로 잇는 모양은 그리지 못한다", () => {
    expect(
      drawable([
        {
          op: "add_edge",
          kind: "data",
          source: { node: "{agent}", port: "telepathy" },
          target: { node: "{output}", port: "input" },
        },
      ]),
    ).toBe(false);
  });

  it("새로 놓는 단계의 포트도 그 단계의 종류에게 묻는다", () => {
    expect(
      drawable([
        { op: "add_node", node: "{new:gate}", type: "control.human_gate", config: {} },
        {
          op: "add_edge",
          kind: "approval",
          source: { node: "{agent}", port: "response" },
          target: { node: "{new:gate}", port: "telepathy" },
        },
      ]),
    ).toBe(false);
  });

  it("모르는 작업이 섞인 템플릿은 그리지 못한다", () => {
    expect(drawable([{ op: "constructor", node: "{agent}" }])).toBe(false);
  });
});
