// 모델 피커가 이 서버의 사정을 그대로 보여 주는가 (DESIGN.md §7 preset-select 모델 항목).
// 서버에 물어보지 못한 화면은 예전 그대로다 — 그 자리는 inspector.test.tsx가 이미 지킨다.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { Inspector } from "../src/inspector/Inspector";
import { MODEL_CATALOG } from "../src/registry/modelCatalog";
import type { ModelChoice, ServerCatalog } from "../src/registry/modelOptions";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";
const OPENAI_TITLE = "OpenAI의 모델 — gpt-x";
const NO_KEY = "이 서버에는 이 모델을 부를 열쇠가 없어요";
const STAND_IN =
  "지금은 연습용 답으로 돌아요 — 실제 모델을 부르려면 서버에 열쇠를 넣어 주세요";
const NOTHING_CALLABLE =
  "이 서버에 부를 수 있는 모델이 아직 없어요 — 서버 설정에서 열쇠를 넣어 주세요";

const openai: ModelChoice = {
  ref: "model://openai",
  title: { ko: OPENAI_TITLE, en: "OpenAI — gpt-x" },
  callable: true,
  reason: null,
};

const anthropic: ModelChoice = {
  ref: "model://default",
  title: { ko: "기본 모델", en: "Default model" },
  callable: false,
  reason: "missing_secret",
};

function store() {
  return useEditor.getState();
}

function typeField() {
  return screen.getByRole("textbox", { name: /사용할 모델/ });
}

function pickField() {
  return screen.getByRole("combobox", { name: /사용할 모델/ });
}

function configOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.spec.config;
}

/** 서버가 이렇게 답하는 화면 — 카드가 서면서 스스로 물어본다. */
async function cardKnowing(models: ModelChoice[] | null, mode: "live" | "stand_in" = "live") {
  const said: ServerCatalog | null = models === null ? null : { mode, models };
  const fetchServerModels = vi.fn(async () => said);
  useEditor.setState({ fetchServerModels });
  render(<Inspector />);
  await waitFor(() => expect(fetchServerModels).toHaveBeenCalled());
  return fetchServerModels;
}

beforeEach(() => {
  store().loadSpec(example);
  useEditor.setState({ serverModels: null });
  act(() => store().select("node", AGENT));
});

describe("the models this server can actually call", () => {
  it("asks the server as soon as the settings card is open", async () => {
    const asked = await cardKnowing([openai, anthropic]);

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("offers what this server can call before anything else", async () => {
    await cardKnowing([anthropic, openai]);

    expect(within(pickField()).getAllByRole("option")[0]).toHaveTextContent(
      OPENAI_TITLE,
    );
  });

  it("keeps showing what it cannot call, greyed out with the reason", async () => {
    await cardKnowing([anthropic, openai]);

    const unreachable = within(pickField()).getByRole("option", { name: "기본 모델" });
    expect(unreachable).toBeDisabled();
    expect(unreachable).toHaveAttribute("title", NO_KEY);
  });

  it("leaves typing a name by hand as the last way out", async () => {
    await cardKnowing([anthropic, openai]);

    expect(within(pickField()).getAllByRole("option").at(-1)).toHaveTextContent(
      "직접 적기…",
    );
  });

  it("writes the ref of the model the person picked", async () => {
    await cardKnowing([anthropic, openai]);

    await userEvent.selectOptions(pickField(), OPENAI_TITLE);

    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://openai" });
  });

  it("says out loud when this server can call nothing yet", async () => {
    await cardKnowing([anthropic]);

    expect(screen.getByText(NOTHING_CALLABLE)).toBeInTheDocument();
  });

  it("says nothing of the sort when the server can call something", async () => {
    await cardKnowing([anthropic, openai]);

    expect(screen.queryByText(NOTHING_CALLABLE)).not.toBeInTheDocument();
  });

  // fail-open — 못 물어본 것은 "부를 수 없다"가 아니다: 예전 그대로 고를 수 있다.
  it("offers the bundled catalog, all pickable, when the server cannot be asked", async () => {
    await cardKnowing(null);

    const options = within(pickField()).getAllByRole("option");
    // 번들 카탈로그가 실은 그대로 — 목록도, 차례도, 이름도 이 변경 이전과 같다.
    expect(options.map((option) => option.textContent)).toEqual([
      ...Object.values(MODEL_CATALOG).map((definition) => definition.title.ko),
      "직접 적기…",
    ]);
    expect(options.every((option) => !(option as HTMLOptionElement).disabled)).toBe(true);
    expect(screen.queryByText(NOTHING_CALLABLE)).not.toBeInTheDocument();
  });

  // 서버 목록이 바뀌어도 저장된 값은 조용히 바뀌지 않는다 (DESIGN §7 preset-select).
  it("keeps showing a saved model this server cannot call, and changes nothing", async () => {
    await cardKnowing([anthropic, openai]);

    expect(pickField()).toHaveValue("model://default");
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://default" });
  });

  it("keeps a saved name neither list knows in the box the person can edit", async () => {
    act(() => store().updateNodeConfig(AGENT, { model_ref: "model://legacy-x" }));

    await cardKnowing([anthropic, openai]);

    expect(typeField()).toHaveValue("model://legacy-x");
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://legacy-x" });
  });

  // 열쇠 없는 서버의 실행은 연습용 답으로 모든 이름에 답한다 — 화면이 전부 잠그면 거짓이다.
  it("lets every model be picked on a server that answers with stand-in text", async () => {
    await cardKnowing([anthropic], "stand_in");

    const options = within(pickField()).getAllByRole("option");
    expect(options.every((option) => !(option as HTMLOptionElement).disabled)).toBe(true);
    expect(screen.getByText(STAND_IN)).toBeInTheDocument();
    expect(screen.queryByText(NOTHING_CALLABLE)).not.toBeInTheDocument();
  });

  it("names the models in english for a reader of english", async () => {
    const { setLocale } = await import("../src/i18n/localeStore");
    act(() => setLocale("en"));
    await cardKnowing([openai, anthropic]);

    expect(
      within(screen.getByRole("combobox", { name: /Model to use/ })).getByRole(
        "option",
        { name: "OpenAI — gpt-x" },
      ),
    ).toBeInTheDocument();
  });
});
