// 이 카드에 뜨는 말의 규칙 (DESIGN §7 connection-hint "말은 화면에 보이는 것으로 한다").
// 문구를 통째로 박지 않는다 — 규칙을 어기면 빨개지는 형태로 계약만 고정한다.
// 검사 대상은 손으로 적지 않는다: 이 카드에 뜨는 접두사(`connection.`·`hint.`)의 문구를 모두 끌어온다.
// 새 문구가 생기면 그날부터 같은 규칙을 받는다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { checkConnection } from "../src/graph/connection";
import type { AgentSpec } from "../src/generated/agent_spec";
import { LOCALES, type Locale } from "../src/i18n/locale";
import {
  MESSAGES,
  type Message,
  type MessageKey,
  msg,
  translate,
} from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const DROPPED_AT = { x: 10, y: 20 };

/**
 * 빈칸을 채울 대역들. 포트·노드 이름 자리에는 일부러 **내부 이름표처럼 생긴 값**을 넣는다 —
 * 문구가 내부 이름표를 부르려 하면 그 자리에서 규칙 위반이 드러난다.
 */
const STAND_IN = {
  port: "response",
  source: "route",
  target: "messages",
  sourceWord: msg("type.text"),
  targetWord: msg("type.list"),
  node: "clinical-agent",
  type: "llm.router",
};

/** 이 카드가 말을 꺼내는 사전의 접두사들 — 거절(connection.)과 안내(hint.). */
const SPOKEN_HERE = ["connection.", "hint."];

/** 이 카드에 뜰 수 있는 말 전부 — 사전이 늘어나면 이 목록도 함께 늘어난다. */
const HINT_KEYS = (Object.keys(MESSAGES) as MessageKey[]).filter((key) =>
  SPOKEN_HERE.some((prefix) => key.startsWith(prefix)),
);

const SAID: [MessageKey, Message][] = HINT_KEYS.map((key) => [
  key,
  msg(key, STAND_IN),
]);

function said(message: Message, locale: Locale): string {
  return translate(locale, message);
}

describe("연결 안내가 쓰는 말", () => {
  it("이 카드가 꺼내는 사전 문구를 하나도 빠뜨리지 않고 검사한다", () => {
    expect(HINT_KEYS.length).toBe(
      Object.keys(MESSAGES).filter((key) =>
        SPOKEN_HERE.some((prefix) => key.startsWith(prefix)),
      ).length,
    );
    expect(HINT_KEYS.length).toBeGreaterThan(1);
    // 안내 톤의 말도 거절과 같은 규칙을 받는다 (첫 연결 초대).
    expect(HINT_KEYS.filter((key) => key.startsWith("hint.")).length).toBeGreaterThan(0);
  });

  it.each(SAID)("%s — 내부 id 문법을 화면에 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      // 'node.port'처럼 점으로 이은 내부 이름표는 사용자가 읽는 글이 아니다.
      expect(said(message, locale)).not.toMatch(/[A-Za-z_][\w-]*\.[A-Za-z_]/);
    }
  });

  it.each(SAID)("%s — 노드의 내부 이름을 화면에 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      for (const nodeId of ["clinical-agent", "human-gate", "triage", "ghost"]) {
        expect(said(message, locale)).not.toContain(nodeId);
      }
    }
  });

  it.each(SAID)("%s — 자료형 원문을 그대로 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      for (const raw of ["string", "array", "object", "boolean", "integer"]) {
        expect(said(message, locale)).not.toContain(raw);
      }
    }
  });

  it.each(SAID)("%s — 이유로 끝내지 않고 다음 걸음을 말한다", (_key, message) => {
    for (const locale of LOCALES) {
      const [reason, nextStep, ...rest] = said(message, locale).split(" — ");
      expect(reason?.trim().length ?? 0).toBeGreaterThan(0);
      expect(nextStep?.trim().length ?? 0).toBeGreaterThan(0);
      // 한 줄에 두 걸음을 담지 않는다 — 이유 하나, 다음 걸음 하나.
      expect(rest).toEqual([]);
    }
  });

  // 한 카드가 두 목소리로 말하지 않는다: 이유 절과 다음 걸음 절 양쪽의 말투를 본다.
  it.each(SAID)("%s — 한국어는 두 절 모두 해요체다", (_key, message) => {
    const [reason, nextStep] = said(message, "ko").split(" — ");
    expect(reason).toMatch(/요$/);
    // 권하거나(보세요) 우리가 하겠다고(드릴게요·드려요) 말하는 두 갈래 모두 해요체다.
    expect(nextStep).toMatch(/(보세요|드릴게요|드려요)$/);
  });

  it.each(SAID)("%s — 영어는 이유를 말하고 할 일을 시킨다", (_key, message) => {
    const [reason, nextStep] = said(message, "en").split(" — ");
    // 이유는 한 문장처럼 시작한다: 큰따옴표로 감싼 포트 이름이거나 대문자.
    expect(reason).toMatch(/^['A-Z]/);
    // 다음 걸음은 시키는 말로 시작한다 — 주어로 시작하는 서술은 이 카드의 목소리가 아니다.
    const firstWord = nextStep.trim().split(" ")[0];
    expect(firstWord).toMatch(/^[a-z]+$/);
    expect(["we", "it", "the", "there", "this", "these", "that", "you", "a", "an"]).not.toContain(
      firstWord,
    );
  });

  it.each(SAID)("%s — 마침표로 닫지 않는다 (카드의 한 줄)", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/\.$/);
    }
  });

  it.each(SAID)("%s — 두 언어로 말한다", (_key, message) => {
    expect(said(message, "ko").trim()).not.toBe("");
    expect(said(message, "en").trim()).not.toBe("");
    expect(said(message, "ko")).not.toBe(said(message, "en"));
  });

  it.each(SAID)("%s — 채우지 못한 빈칸을 화면에 남기지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/[{}]/);
    }
  });
});

// 사전이 규칙을 지켜도, 부르는 쪽이 내부 이름표를 넣어 주면 화면에서 새어 나간다.
describe("손이 한 번 움직였을 때 실제로 뜨는 말", () => {
  /** 손이 한 번 움직인 결과로 이 카드에 뜬 말. */
  function refusalOf(connect: () => void): string {
    store().loadSpec(example);
    connect();
    const hint = store().connectionHint;
    if (!hint) throw new Error("아무 말도 뜨지 않았다");
    return translate("ko", hint.message);
  }

  function reasonOf(source: [string, string], target: [string, string]): string {
    store().loadSpec(example);
    const check = checkConnection(
      store().exportSpec(),
      { node: source[0], port: source[1] },
      { node: target[0], port: target[1] },
    );
    if (check.ok || !check.reason) throw new Error("거절하지 않았다");
    return translate("ko", check.reason);
  }

  const REAL: Record<string, string> = {
    종류가다름: refusalOf(() =>
      store().connect(
        {
          source: "triage",
          sourceHandle: "route",
          target: "clinical-agent",
          targetHandle: "messages",
        },
        DROPPED_AT,
      ),
    ),
    이미이어짐: refusalOf(() =>
      store().connect(
        {
          source: "input",
          sourceHandle: "question",
          target: "triage",
          targetHandle: "input",
        },
        DROPPED_AT,
      ),
    ),
    제자리돌기: refusalOf(() =>
      store().connect(
        {
          source: "human-gate",
          sourceHandle: "rejected",
          target: "triage",
          targetHandle: "input",
        },
        DROPPED_AT,
      ),
    ),
    받는자리없음: reasonOf(["triage", "route"], ["output", "nope"]),
    내보내는자리없음: reasonOf(["input", "nope"], ["triage", "input"]),
    노드없음: reasonOf(["ghost", "route"], ["output", "input"]),
  };

  it.each(Object.entries(REAL))("%s — 빈칸에 내부 이름표를 넣지 않는다", (_name, text) => {
    expect(text).not.toMatch(/[A-Za-z_][\w-]*\.[A-Za-z_]/);
    for (const nodeId of ["clinical-agent", "human-gate", "triage", "ghost"]) {
      expect(text).not.toContain(nodeId);
    }
  });

  it("사용자가 캔버스에서 읽는 포트 이름을 그대로 가리킨다", () => {
    expect(REAL.종류가다름).toContain("route");
    expect(REAL.종류가다름).toContain("messages");
  });
});

describe("종류가 다르다는 말", () => {
  it("자료형을 쉬운 말로 옮겨 말한다", () => {
    const mismatch = msg("connection.typeMismatch", STAND_IN);
    expect(said(mismatch, "ko")).toContain("글자");
    expect(said(mismatch, "en")).toContain("text");
  });

  it("쉬운 말이 없는 종류는 이름 없이 종류가 다르다고만 말한다", () => {
    const union = {
      ...example,
      input_schema: {
        type: "object",
        properties: { question: { type: ["string", "null"] } },
      },
    } as AgentSpec;
    const check = checkConnection(
      union,
      { node: "input", port: "question" },
      { node: "clinical-agent", port: "messages" },
    );

    expect(check.ok).toBe(false);
    expect(check.reason && said(check.reason, "ko")).toContain("종류가 달라요");
  });
});
