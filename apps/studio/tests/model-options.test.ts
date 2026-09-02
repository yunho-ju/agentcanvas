// 피커가 무엇을 어떤 차례로 내놓는가 — 서버가 말한 사정과 번들 목록을 합치는 규칙 하나.
// 서버에 물어보지 못한 것은 "부를 수 없다"가 아니다(fail-open): 그때는 예전 그대로 보여 준다.
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../src/registry/modelCatalog";
import {
  type ModelChoice,
  type ServerCatalog,
  modelPicking,
  serverCatalogOf,
} from "../src/registry/modelOptions";

const OPENAI = "model://openai";
const DEFAULT_MODEL = "model://default";

function aModel(ref: string, callable: boolean): ModelChoice {
  return {
    ref,
    title: { ko: `${ref} 이름`, en: `${ref} title` },
    callable,
    reason: callable ? null : "missing_secret",
  };
}

function live(...models: ModelChoice[]): ServerCatalog {
  return { mode: "live", models };
}

describe("what the picker offers when the server calls real models", () => {
  const answered = live(aModel(DEFAULT_MODEL, false), aModel(OPENAI, true));

  it("puts what this server can call first", () => {
    expect(modelPicking(answered).options.map((option) => option.ref)).toEqual([
      OPENAI,
      DEFAULT_MODEL,
    ]);
  });

  it("keeps the server's own order among the ones it can call", () => {
    const two = live(aModel(OPENAI, true), aModel("model://local", true));

    expect(modelPicking(two).options.map((option) => option.ref)).toEqual([
      OPENAI,
      "model://local",
    ]);
  });

  it("still shows what it cannot call, with the reason it gave", () => {
    expect(modelPicking(answered).options[1]).toEqual({
      ref: DEFAULT_MODEL,
      title: { ko: `${DEFAULT_MODEL} 이름`, en: `${DEFAULT_MODEL} title` },
      callable: false,
      reason: "missing_secret",
    });
  });

  it("says nothing extra while something can be called", () => {
    expect(modelPicking(answered).note).toBeNull();
  });

  it("says out loud when this server can call none of them", () => {
    expect(modelPicking(live(aModel(DEFAULT_MODEL, false))).note).toBe("none_callable");
  });
});

// 열쇠가 하나도 없는 서버는 실행이 연습용 답으로 모든 이름에 답한다 — 화면이 전부 잠그면 거짓이다.
describe("what the picker offers on a server running stand-in answers", () => {
  const practising: ServerCatalog = {
    mode: "stand_in",
    models: [aModel(DEFAULT_MODEL, false), aModel("model://claude-opus", false)],
  };

  it("lets every model be picked, however few keys this server holds", () => {
    expect(modelPicking(practising).options.every((option) => option.callable)).toBe(
      true,
    );
  });

  it("says which kind of answers this server gives instead of blaming the keys", () => {
    expect(modelPicking(practising).note).toBe("stand_in");
  });
});

describe("what the picker offers when the server could not be asked", () => {
  it("offers the bundled catalog exactly as it ships", () => {
    expect(modelPicking(null).options.map((option) => option.ref)).toEqual(
      Object.keys(MODEL_CATALOG),
    );
  });

  it("blocks nothing it does not know about", () => {
    expect(modelPicking(null).options.every((option) => option.callable)).toBe(true);
    expect(modelPicking(null).note).toBeNull();
  });

  // 모델을 건네받은 배선의 서버는 아무 판정도 말하지 않는다 — 그 침묵은 "없다"가 아니다.
  it("falls back to the bundled catalog when the server judges nothing", () => {
    expect(modelPicking(live()).options.map((option) => option.ref)).toEqual(
      Object.keys(MODEL_CATALOG),
    );
    expect(modelPicking(live()).note).toBeNull();
  });
});

describe("reading what the server said", () => {
  const said = {
    mode: "live",
    models: [
      {
        ref: OPENAI,
        title: { ko: "OpenAI의 모델 — gpt-x", en: "OpenAI — gpt-x" },
        callable: true,
        reason: null,
      },
    ],
  };

  it("takes the mode, the ref, the name, and whether it can be called now", () => {
    expect(serverCatalogOf(said)).toEqual({
      mode: "live",
      models: [
        {
          ref: OPENAI,
          title: { ko: "OpenAI의 모델 — gpt-x", en: "OpenAI — gpt-x" },
          callable: true,
          reason: null,
        },
      ],
    });
  });

  it("reads the stand-in mode too", () => {
    expect(serverCatalogOf({ ...said, mode: "stand_in" })?.mode).toBe("stand_in");
  });

  it.each([
    ["a bare list without the mode", said.models],
    ["a mode nobody knows", { ...said, mode: "whatever" }],
    ["models that are not a list", { mode: "live", models: {} }],
    ["a model with no ref", { mode: "live", models: [{ title: {}, callable: true }] }],
    [
      "a model that does not say whether it can be called",
      { mode: "live", models: [{ ref: OPENAI, title: { ko: "가", en: "a" } }] },
    ],
    [
      "a name in one language only",
      { mode: "live", models: [{ ref: OPENAI, title: { ko: "가" }, callable: true }] },
    ],
  ])("says it does not know rather than guessing when the answer is %s", (_what, body) => {
    expect(serverCatalogOf(body)).toBeNull();
  });
});
