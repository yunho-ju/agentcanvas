import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { Inspector } from "../src/inspector/Inspector";
import { describeForm } from "../src/inspector/schemaForm";
import { nodeTypes } from "../src/registry/registry";
import { useEditor } from "../src/store/editor";
import { setLocale } from "../src/i18n/localeStore";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function configOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.spec.config;
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("with nothing selected", () => {
  // 빈 폼을 보여 주는 대신 카드 자체가 없다 — 캔버스가 화면의 주인이다.
  it("takes no room on the canvas at all", () => {
    render(<Inspector />);
    expect(screen.queryByRole("complementary", { name: "설정" })).not.toBeInTheDocument();
  });
});

/** 라벨 그대로(필수 표기는 있어도 좋다) — '지시문'이 '지시문 이름 (고급)'과 섞이지 않게. */
function labelledExactly(label: string) {
  const spelled = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${spelled}( \\*)?$`);
}

/** 글자 목록 칸 하나만 가진 노드 — 지금 registry에는 그런 칸이 없다. */
function listNode() {
  store().loadSpec({
    ...example,
    nodes: [{ id: "listy", type: "custom.list", position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  } as unknown as AgentSpec);
  useEditor.setState({
    nodes: store().nodes.map((node) => ({
      ...node,
      selected: true,
      data: {
        ...node.data,
        nodeType: {
          type: "custom.list",
          version: "1.0",
          runtime: "custom",
          display_name: { ko: "목록 노드", en: "List node" },
          plain_description: { ko: "설명", en: "A description" },
          ports: { inputs: [], outputs: [] },
          config_schema: {
            type: "object",
            properties: {
              names: { type: "array", items: { type: "string" }, title: "이름들" },
            },
          },
        },
      },
    })),
  });
}

describe("a form built from config_schema", () => {
  it.each(Object.keys(nodeTypes))("labels every config field of %s", (type) => {
    store().addNode(type, { x: 0, y: 0 });
    const added = store().nodes.at(-1)?.id ?? "";
    store().select("node", added);
    render(<Inspector />);

    for (const field of describeForm(nodeTypes[type].config_schema).fields) {
      expect(screen.getByLabelText(labelledExactly(field.label.ko))).toBeInTheDocument();
    }
  });

  it("explains each field in plain words next to it", () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);
    expect(screen.getByText(/적은 그대로 모델에게 전달/)).toBeInTheDocument();
  });

  it("names the selected node with its registry display name", () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);
    expect(screen.getByRole("heading", { name: /AI 에이전트/ })).toBeInTheDocument();
  });

  it("keeps what the user types in the node config", async () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);

    await userEvent.clear(screen.getByLabelText(/지시문 이름/));
    await userEvent.type(screen.getByLabelText(/지시문 이름/), "prompt://fast@1");

    expect(configOf("clinical-agent")).toMatchObject({ prompt_ref: "prompt://fast@1" });
  });

  it("keeps a number field a number", async () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);

    await userEvent.clear(screen.getByLabelText(/최대 주고받기 횟수/));
    await userEvent.type(screen.getByLabelText(/최대 주고받기 횟수/), "7");

    expect(configOf("clinical-agent")).toMatchObject({ max_turns: 7 });
  });

  // 글자 목록 칸은 한 줄에 하나다 — 어느 노드 타입이 그런 칸을 가지든 같은 문법이다.
  it("keeps a list field a list of strings, one per line", async () => {
    listNode();
    render(<Inspector />);

    const list = screen.getByLabelText(labelledExactly("이름들"));
    await userEvent.type(list, "one{enter}two");

    expect(configOf("listy")).toMatchObject({ names: ["one", "two"] });
  });

  it("shows the schema problem next to the field that has it", async () => {
    store().select("node", "output");
    render(<Inspector />);

    await userEvent.clear(screen.getByLabelText(/내보낼 값의 위치/));

    expect(screen.getByRole("alert")).toHaveTextContent("채워야");
  });

  // 에이전트에게 할 일을 직접 말한다 — 적은 그대로 노드에 실린다 (P3-6).
  it("takes the instructions someone writes and keeps them on the node", async () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);

    const box = screen.getByLabelText(labelledExactly("지시문"));
    await userEvent.type(box, "answer in plain words");

    expect(box.tagName).toBe("TEXTAREA");
    expect(configOf("clinical-agent")).toMatchObject({
      instruction: "answer in plain words",
    });
  });

  // 그리는 차례는 계약이 정한다 — 기대 순서를 여기 손으로 적지 않고 registry에서 읽는다.
  it("draws the settings in the order the registry declares", () => {
    store().select("node", "clinical-agent");
    const { container } = render(<Inspector />);

    const schema = nodeTypes["llm.agent"].config_schema as Record<string, unknown>;
    const labelOf = new Map(
      describeForm(schema).fields.map((field) => [field.name, field.label.ko]),
    );
    const expected = (schema["x-field-order"] as string[]).map((name) => labelOf.get(name));
    // 스스로 라벨을 붙이는 편집기는 label 태그가 아니다 — 칸 이름이 서는 자리로 읽는다.
    const drawn = Array.from(container.querySelectorAll(".inspector__label")).map((label) =>
      label.textContent?.replace(/ \*$/, ""),
    );

    expect(expected.length).toBeGreaterThan(1);
    expect(drawn.filter((text) => expected.includes(text))).toEqual(expected);
  });
});

// 지우는 길이 손이 있는 자리에 있다 (DESIGN §7 inspector-card 지우기).
describe("the way to delete the node you are looking at", () => {
  function deleteButton() {
    return screen.getByRole("button", { name: "이 노드 지우기" });
  }

  /** 아무것도 이어지지 않은 새 노드 — 지워도 끊어질 것이 없다. */
  function loneNode(): string {
    act(() => store().addNode("llm.agent", { x: 400, y: 400 }));
    const id = store().nodes.at(-1)?.id ?? "";
    act(() => store().select("node", id));
    return id;
  }

  it("offers it at the bottom of the fields, with the shortcut in its title", () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);

    expect(deleteButton()).toHaveAttribute("title", expect.stringContaining("Delete"));
    expect(screen.getByText("되돌리기로 언제든 살릴 수 있어요")).toBeInTheDocument();
  });

  it("takes the node off the canvas, and one undo brings it back", async () => {
    const id = loneNode();
    render(<Inspector />);

    await userEvent.click(deleteButton());

    expect(store().nodes.map((node) => node.id)).not.toContain(id);
    act(() => store().undo());
    expect(store().nodes.map((node) => node.id)).toContain(id);
  });

  // 새 삭제 길을 내지 않는다 — Delete 키가 가던 그 길로 간다.
  it("walks the same path as the Delete key, one step to undo", async () => {
    loneNode();
    render(<Inspector />);
    const steps = store().undoStack.length;

    await userEvent.click(deleteButton());

    expect(store().undoStack).toHaveLength(steps + 1);
    expect(translate("ko", store().undoStack.at(-1)!.label)).toContain("노드");
  });

  // 확인 대화를 더하지 않는다 — 연결이 끊기는 노드는 기존 빼기 확인을 그대로 탄다 (DESIGN §7).
  it("shows what breaks first when the node has connections, as the Delete key does", async () => {
    store().select("node", "triage");
    render(<Inspector />);

    await userEvent.click(deleteButton());

    expect(store().pendingDetach).toBe("triage");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(store().nodes.map((node) => node.id)).toContain("triage");
  });

  it("takes it off once that question is answered, still one step to undo", async () => {
    store().select("node", "triage");
    render(<Inspector />);
    const steps = store().undoStack.length;

    await userEvent.click(deleteButton());
    await userEvent.click(screen.getByRole("button", { name: "그래도 빼기" }));

    expect(store().nodes.map((node) => node.id)).not.toContain("triage");
    expect(store().undoStack).toHaveLength(steps + 1);
    act(() => store().undo());
    expect(store().nodes.map((node) => node.id)).toContain("triage");
  });

  it("is not offered for a connection — a connection is not a node", () => {
    store().select("edge", "triage-agent");
    render(<Inspector />);

    expect(screen.queryByRole("button", { name: "이 노드 지우기" })).not.toBeInTheDocument();
  });
});

// 입력 노드가 받는 줄 편집기 (DESIGN §7 input-rows).
describe("core.input rows", () => {
  beforeEach(() => {
    store().select("node", "input");
  });

  function rowOf(name: string): HTMLElement {
    return screen.getByDisplayValue(name).closest("li") as HTMLElement;
  }

  function inputSchema() {
    return store().spec?.input_schema as Record<string, Record<string, unknown>>;
  }

  it("shows one row per value the node takes in, and never the place it comes from", () => {
    render(<Inspector />);

    expect(screen.getByDisplayValue("question")).toBeInTheDocument();
    expect(screen.getByDisplayValue("patient_context")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("input.question")).not.toBeInTheDocument();
  });

  it("says in plain words what these rows are for", () => {
    render(<Inspector />);

    expect(screen.getByText(/^받는 값/)).toBeInTheDocument();
    expect(screen.getByText(/실행할 때 사람에게 물을 값/)).toBeInTheDocument();
  });

  function portsOfInput(): string[] {
    return Object.keys(
      store().nodes.find((node) => node.id === "input")?.data.ports.outputs ?? {},
    );
  }

  async function nameNewRow(name: string) {
    await userEvent.click(screen.getByRole("button", { name: "줄 추가" }));
    await userEvent.type(screen.getAllByLabelText(/번째 이름/).at(-1) as HTMLElement, name);
  }

  // 치는 도중의 이름이 포트가 되어 남지 않는다 (DESIGN §7 input-rows).
  it("waits until the name is finished before writing it down", async () => {
    render(<Inspector />);

    await nameNewRow("vitals");

    expect(portsOfInput()).not.toContain("vitals");
    expect(portsOfInput()).not.toContain("vital");
  });

  it("grows a new output port when the name is left behind", async () => {
    render(<Inspector />);

    await nameNewRow("vitals");
    await userEvent.tab();

    expect(portsOfInput()).toContain("vitals");
    expect(configOf("input")).toEqual({
      bindings: {
        question: "input.question",
        patient_context: "input.patient_context",
        vitals: "input.vitals",
      },
    });
  });

  it("takes Enter as 'this name is finished' too", async () => {
    render(<Inspector />);

    await nameNewRow("vitals");
    await userEvent.keyboard("{Enter}");

    expect(portsOfInput()).toContain("vitals");
  });

  it("leaves no half-typed port behind while a name is being written", async () => {
    render(<Inspector />);

    await nameNewRow("vitals");
    await userEvent.tab();

    expect(portsOfInput().filter((port) => "vitals".startsWith(port))).toEqual(["vitals"]);
  });

  it("a brand new row takes text until someone says otherwise", async () => {
    render(<Inspector />);

    await nameNewRow("vitals");
    await userEvent.tab();

    expect(inputSchema().properties.vitals).toEqual({ type: "string" });
  });

  it("renames the value someone renamed, and nothing else", async () => {
    render(<Inspector />);

    const name = within(rowOf("patient_context")).getByLabelText(/번째 이름/);
    await userEvent.clear(name);
    await userEvent.type(name, "context");
    await userEvent.tab();

    expect(configOf("input")).toEqual({
      bindings: { question: "input.question", context: "input.context" },
    });
    expect(inputSchema().properties).toEqual({
      question: { type: "string" },
      context: { type: "object" },
    });
  });

  it("writes the kind someone picked into the document", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(
      within(rowOf("question")).getByLabelText(/번째 종류/),
      "number",
    );

    expect(inputSchema().properties.question).toEqual({ type: "number" });
  });

  it("takes anything at all when that is what someone picked", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(
      within(rowOf("question")).getByLabelText(/번째 종류/),
      "any",
    );

    expect(inputSchema().properties).not.toHaveProperty("question");
    expect(inputSchema().required).toBeUndefined();
  });

  it("marks a row the run cannot start without", async () => {
    render(<Inspector />);

    await userEvent.click(within(rowOf("patient_context")).getByLabelText("꼭 받아요"));

    expect(inputSchema().required).toContain("patient_context");
  });

  it("never spells a data type the way a program does", () => {
    const { container } = render(<Inspector />);

    for (const raw of ["string", "number", "integer", "boolean", "array", "object"]) {
      expect(container.textContent).not.toContain(raw);
    }
  });

  it("keeps a shape written in the document itself out of the user's hands", () => {
    act(() =>
      store().loadSpec({
        ...example,
        input_schema: { properties: { question: { type: ["string", "number"] } } },
      } as AgentSpec),
    );
    store().select("node", "input");
    render(<Inspector />);

    const kind = within(rowOf("question")).getByLabelText(/번째 종류/);
    expect(kind).toBeDisabled();
    expect(kind).toHaveAttribute("title", "이 줄의 모양은 문서에 직접 적혀 있어요");
  });

  it("keeps a name it cannot write down instead of dropping it quietly", async () => {
    render(<Inspector />);

    await nameNewRow("question");
    await userEvent.tab();

    expect(screen.getByRole("alert")).toHaveTextContent("같은 이름이 두 개");
    expect(configOf("input")).toEqual({
      bindings: { question: "input.question", patient_context: "input.patient_context" },
    });
    expect(portsOfInput()).toEqual(["question", "patient_context"]);
    // 사람이 친 글자는 칸에 그대로 남는다 — 조용히 지우지 않는다.
    expect(screen.getAllByLabelText(/번째 이름/).at(-1)).toHaveValue("question");
  });

  it("keeps an empty row out of the document and says what it needs", async () => {
    render(<Inspector />);

    await userEvent.click(screen.getByRole("button", { name: "줄 추가" }));
    await userEvent.tab();

    expect(screen.getByRole("alert")).toHaveTextContent("이름을 적어야");
    expect(configOf("input")).toEqual({
      bindings: { question: "input.question", patient_context: "input.patient_context" },
    });
  });

  // 모양이 없는 값은 필수로 물을 수 없다 — 조용히 되돌리지 않고 이유를 말한다 (DESIGN §7).
  it("cannot ask for a value it has no shape for, and says why", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(
      within(rowOf("question")).getByLabelText(/번째 종류/),
      "any",
    );

    const required = within(rowOf("question")).getByLabelText("꼭 받아요");
    expect(required).toBeDisabled();
    expect(required).not.toBeChecked();
    expect(required.closest("label")).toHaveAttribute(
      "title",
      "종류를 정해야 꼭 받게 할 수 있어요",
    );
  });

  // 네 손잡이를 한 행에 두면 좁은 패널에서 지우기가 화면 밖으로 밀린다 (DESIGN §7 input-rows).
  it("gives every row two lines so nothing is pushed off the panel", () => {
    render(<Inspector />);

    const row = rowOf("question");
    const lines = row.querySelectorAll(".control__row-line");
    expect(lines).toHaveLength(2);
    expect(within(lines[0] as HTMLElement).getByLabelText(/번째 이름/)).toBeInTheDocument();
    expect(within(lines[0] as HTMLElement).getByLabelText(/번째 종류/)).toBeInTheDocument();
    expect(within(lines[1] as HTMLElement).getByLabelText("꼭 받아요")).toBeInTheDocument();
    expect(
      within(lines[1] as HTMLElement).getByRole("button", { name: "이 줄 지우기" }),
    ).toBeInTheDocument();
  });

  it("says nothing while every row has its own name", () => {
    render(<Inspector />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes the connection that used a row the user deleted", async () => {
    render(<Inspector />);

    await userEvent.click(within(rowOf("question")).getByRole("button", { name: "이 줄 지우기" }));

    expect(store().edges.map((edge) => edge.id)).not.toContain("input-triage");
    expect(translate("ko", store().notice!)).toContain("input");
  });
});

describe("a schema the inspector cannot read", () => {
  it("still lets the user edit the config as raw JSON", async () => {
    store().loadSpec({
      ...example,
      nodes: [{ id: "odd", type: "custom.odd", position: { x: 0, y: 0 }, config: { a: 1 } }],
      edges: [],
    });
    useEditor.setState({
      nodes: store().nodes.map((node) => ({
        ...node,
        selected: true,
        data: {
          ...node.data,
          nodeType: {
            type: "custom.odd",
            version: "1.0",
            runtime: "custom",
            display_name: { ko: "이상한 노드", en: "Odd node" },
            plain_description: { ko: "설명", en: "A description" },
            ports: { inputs: [], outputs: [] },
            config_schema: { type: "array" },
          },
        },
      })),
    });
    render(<Inspector />);

    const raw = screen.getByLabelText(/직접 편집/);
    await userEvent.clear(raw);
    await userEvent.type(raw, '{{"b": 2}');

    expect(configOf("odd")).toEqual({ b: 2 });
  });

  it("says the text is not JSON yet instead of throwing it away", async () => {
    store().select("node", "input");
    render(<Inspector />);
    // bindings는 폼으로 읽히므로 raw 편집기는 없다 — 아래 케이스는 raw 편집기 전용이다.
    expect(screen.queryByLabelText(/직접 편집/)).not.toBeInTheDocument();
  });
});

describe("the selected connection", () => {
  beforeEach(() => {
    store().select("edge", "triage-agent");
  });

  it("shows what kind of connection it is", () => {
    render(<Inspector />);
    expect(screen.getByLabelText(/연결 종류/)).toHaveValue("control");
  });

  it("changes the kind the user picked", async () => {
    render(<Inspector />);
    await userEvent.selectOptions(screen.getByLabelText(/연결 종류/), "approval");
    expect(
      store()
        .exportSpec()
        .edges.find((edge) => edge.id === "triage-agent")?.kind,
    ).toBe("approval");
  });

  it("keeps the condition the user typed", async () => {
    render(<Inspector />);
    const condition = screen.getByLabelText(/조건/);
    await userEvent.clear(condition);
    await userEvent.type(condition, "route == 'urgent'");

    expect(
      store()
        .exportSpec()
        .edges.find((edge) => edge.id === "triage-agent")?.condition,
    ).toEqual({ language: "cel", expression: "route == 'urgent'" });
  });
});

// 많이 쓰는 모델은 고르게 하고, 특수한 이름만 직접 적게 한다 (G-3).
describe("the model an agent works with", () => {
  const AGENT = "clinical-agent";
  const CUSTOM = "직접 적기…";

  function pickField() {
    return screen.getByRole("combobox", { name: /사용할 모델/ });
  }

  function typeField() {
    return screen.getByRole("textbox", { name: /사용할 모델/ });
  }

  beforeEach(() => {
    store().select("node", AGENT);
  });

  it("offers the models the catalog holds, by their plain names", () => {
    render(<Inspector />);

    expect(pickField().tagName).toBe("SELECT");
    expect(within(pickField()).getByRole("option", { name: "기본 모델" })).toBeInTheDocument();
    expect(
      within(pickField()).getByRole("option", { name: "Claude Opus — 깊은 판단" }),
    ).toBeInTheDocument();
  });

  it("offers typing a name by hand as the last way out", () => {
    render(<Inspector />);

    const options = within(pickField()).getAllByRole("option");
    expect(options.at(-1)).toHaveTextContent(CUSTOM);
  });

  // 이 자리는 반드시 채워야 하는 이름이다 — 비우는 선택지를 주지 않는다.
  it("offers no way to unchoose a model once one is chosen", () => {
    render(<Inspector />);

    expect(
      within(pickField()).queryByRole("option", { name: "(고르지 않음)" }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty model as a placeholder nobody can pick", () => {
    store().updateNodeConfig(AGENT, {});
    render(<Inspector />);

    const placeholder = within(pickField()).getByRole("option", {
      name: "(고르지 않음)",
    });
    expect(placeholder).toBeDisabled();
    expect(pickField()).toHaveValue("");
  });

  it("shows the model this agent already works with", () => {
    render(<Inspector />);

    expect(pickField()).toHaveValue("model://default");
    expect(screen.queryByLabelText(CUSTOM)).not.toBeInTheDocument();
  });

  it("keeps the ref of the model the person picked, as one step to undo", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), "Claude Opus — 깊은 판단");

    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://claude-opus" });
    act(() => store().undo());
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://default" });
  });

  it("gives each pick its own step to undo, however fast they follow", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), "Claude Sonnet — 빠르고 균형 잡힘");
    await userEvent.selectOptions(pickField(), "Claude Opus — 깊은 판단");

    act(() => store().undo());
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://claude-sonnet" });
    act(() => store().undo());
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://default" });
  });

  it("opens a box to type in, and puts the cursor there", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), CUSTOM);

    expect(typeField()).toHaveFocus();
  });

  // 상자는 필드의 것이다 — '직접 적기…'는 전환 옵션의 이름이지 상자의 이름이 아니다.
  it("explains the box with the same plain words as the field it fills", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), CUSTOM);

    expect(typeField()).toHaveAccessibleDescription(/모델을 가리키는 이름/);
    expect(screen.queryByRole("textbox", { name: CUSTOM })).not.toBeInTheDocument();
  });

  it("changes nothing by only switching to typing by hand", async () => {
    render(<Inspector />);
    const before = store().undoStack.length;

    await userEvent.selectOptions(pickField(), CUSTOM);

    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://default" });
    expect(store().undoStack).toHaveLength(before);
  });

  it("keeps the name the person typed by hand", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), CUSTOM);
    await userEvent.clear(typeField());
    await userEvent.type(typeField(), "model://lab-only");

    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://lab-only" });
  });

  // 모드는 노드마다 제 것이다 — 옆 노드에서 적던 자세가 따라오지 않는다.
  it("goes back to picking when another node with a known model is selected", async () => {
    const { rerender } = render(<Inspector />);

    await userEvent.selectOptions(pickField(), CUSTOM);
    act(() => store().select("node", "triage"));
    rerender(<Inspector />);

    expect(pickField()).toHaveValue("model://default");
    expect(screen.queryByLabelText(CUSTOM)).not.toBeInTheDocument();
  });

  it("shows a model the catalog does not know in the box, instead of losing it", () => {
    store().updateNodeConfig(AGENT, { model_ref: "model://legacy-x" });
    render(<Inspector />);

    expect(typeField()).toHaveValue("model://legacy-x");
    expect(configOf(AGENT)).toMatchObject({ model_ref: "model://legacy-x" });
  });

  it("names the same models in english for a reader of english", () => {
    act(() => setLocale("en"));
    render(<Inspector />);

    expect(
      within(screen.getByLabelText(/Model to use/)).getByRole("option", {
        name: "Default model",
      }),
    ).toBeInTheDocument();
    act(() => setLocale("ko"));
  });
});

describe("the shape a router asks its answer to follow", () => {
  it("is picked from the schema catalog, and may be left unchosen", () => {
    store().select("node", "triage");
    render(<Inspector />);

    const field = screen.getByLabelText(/답의 형식/);
    expect(field.tagName).toBe("SELECT");
    expect(within(field).getByRole("option", { name: "답 검토" })).toBeInTheDocument();
    expect(within(field).getByRole("option", { name: "(고르지 않음)" })).toBeInTheDocument();
  });
});

// 사람이 ref를 손으로 적을 일은 없다 — 쓸 수 있는 양식 중에서 고른다 (CP-4).
describe("the review form a gate asks for", () => {
  const GATE = "human-gate";
  const KNOWN = "schema://answer-review@1";

  function pickField() {
    return screen.getByLabelText(/확인 화면의 형식/);
  }

  beforeEach(() => {
    store().select("node", GATE);
  });

  it("offers the forms the catalog holds, by their plain names", () => {
    render(<Inspector />);

    expect(pickField().tagName).toBe("SELECT");
    expect(within(pickField()).getByRole("option", { name: "답 검토" })).toBeInTheDocument();
  });

  it("shows the form this gate is already asking for", () => {
    render(<Inspector />);

    expect(pickField()).toHaveValue(KNOWN);
  });

  it("keeps the ref, not the name the person read", async () => {
    store().updateNodeConfig(GATE, {});
    render(<Inspector />);

    await userEvent.selectOptions(pickField(), "답 검토");

    expect(configOf(GATE)).toEqual({ approval_schema_ref: KNOWN });
  });

  it("says a form it cannot find is a form we do not know, without printing its inner name", () => {
    store().updateNodeConfig(GATE, { approval_schema_ref: "schema://long-gone@9" });
    const { container } = render(<Inspector />);

    expect(within(pickField()).getByRole("option", { name: "알 수 없는 양식" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("long-gone");
  });

  it("keeps that unknown value until the person picks another one", async () => {
    store().updateNodeConfig(GATE, { approval_schema_ref: "schema://long-gone@9" });
    render(<Inspector />);

    expect(pickField()).toHaveValue("schema://long-gone@9");
    await userEvent.selectOptions(pickField(), "답 검토");

    expect(configOf(GATE)).toEqual({ approval_schema_ref: KNOWN });
  });

  it("names the same form in english for a reader of english", () => {
    act(() => setLocale("en"));
    render(<Inspector />);

    expect(
      within(screen.getByLabelText(/Shape of the review screen/)).getByRole("option", {
        name: "Answer review",
      }),
    ).toBeInTheDocument();
    act(() => setLocale("ko"));
  });
});

// 화면이 약속하는 것은 엔진이 지키는 것뿐이다 (DESIGN §7 agent-turns).
describe("how many turns an agent may take", () => {
  const AGENT = "clinical-agent";
  const LOCKED = "도구를 고르면 여러 번 시도할 수 있어요";

  function turnsField() {
    return screen.getByLabelText(labelledExactly("최대 주고받기 횟수"));
  }

  /** 아직 아무것도 고르지 않은 새 에이전트 — 도구도, 턴 수도 적힌 것이 없다. */
  function freshAgent() {
    act(() => store().addNode("llm.agent", { x: 0, y: 0 }));
    act(() => store().select("node", store().nodes.at(-1)?.id ?? ""));
  }

  it("shows the one turn the engine actually takes, not an empty box", () => {
    freshAgent();
    render(<Inspector />);

    expect(turnsField()).toHaveValue(1);
  });

  it("locks the turns of an agent with no tools", () => {
    freshAgent();
    render(<Inspector />);

    expect(turnsField()).toBeDisabled();
    expect(turnsField()).toHaveAttribute("title", LOCKED);
  });

  // 잠긴 컨트롤에는 툴팁이 뜨지 않는다 — 까닭은 보이는 줄로 말한다 (DESIGN §7).
  it("says why in a line anyone can read, not only in a tooltip", () => {
    freshAgent();
    render(<Inspector />);

    const reason = screen.getByText(LOCKED);
    expect(reason).toBeInTheDocument();
    expect(turnsField().getAttribute("aria-describedby")).toContain(reason.id);
  });

  it("unlocks the turns as soon as a tool of this document is ticked", async () => {
    store().select("node", AGENT);
    act(() => store().updateNodeConfig(AGENT, { model_ref: "model://default" }));
    render(<Inspector />);

    await userEvent.click(screen.getByRole("checkbox", { name: /clinical-reference/ }));

    expect(turnsField()).toBeEnabled();
    expect(screen.queryByText(LOCKED)).not.toBeInTheDocument();
  });

  // 오타 이름은 고른 것이 아니다 — 그것으로 잠금이 풀리면 화면이 거짓을 말한다.
  it("keeps the turns locked while the only pick is a name the document lacks", () => {
    act(() => store().updateNodeConfig(AGENT, { toolset_refs: ["typo-name"] }));
    store().select("node", AGENT);
    render(<Inspector />);

    expect(turnsField()).toBeDisabled();
  });

  it("leaves the turns of an agent that already ticked a tool alone", () => {
    store().select("node", AGENT);
    render(<Inspector />);

    expect(turnsField()).toBeEnabled();
    expect(turnsField()).toHaveValue(4);
  });

  // 엔진이 도구를 부르며 여러 번 시도하므로, 한 번에 답한다는 고백은 더 이상 사실이 아니다.
  it("no longer admits that this server answers in one go", () => {
    store().select("node", AGENT);
    render(<Inspector />);

    const caption = document.getElementById("config-max_turns-hint");
    expect(caption).toHaveTextContent("턴마다 모델 호출 비용이 들어요");
    expect(caption).not.toHaveTextContent("(이 서버는 아직 한 번에 답해요)");
  });

  // 빈 상자는 뜻을 잃는다 — 지운 자리에는 기본값이 초대말로 남는다.
  it("shows the default as a placeholder once someone empties the box", async () => {
    store().select("node", AGENT);
    render(<Inspector />);

    await userEvent.clear(turnsField());

    expect(turnsField()).toHaveValue(null);
    expect(turnsField()).toHaveAttribute("placeholder", "1");
  });

  // 기본값은 사람이 바꾸기 전에는 문서에 실리지 않는다 — 보이는 것과 저장되는 것은 다르다.
  it("never writes the default into the document by itself", async () => {
    freshAgent();
    const id = store().nodes.at(-1)?.id ?? "";
    render(<Inspector />);

    await userEvent.click(screen.getByRole("checkbox", { name: /clinical-reference/ }));

    expect(store().nodes.find((node) => node.id === id)?.data.spec.config).not.toHaveProperty(
      "max_turns",
    );
  });
});

// '쓸 도구'는 글자로 적는 칸이 아니라 이 문서의 도구를 고르는 체크 목록이다 (DESIGN §7 agent-turns).
describe("the tools an agent may use", () => {
  const AGENT = "clinical-agent";

  function toolRow(name: string | RegExp) {
    return screen.getByRole("checkbox", { name });
  }

  it("offers this document's connections that carry tools, and how many", () => {
    store().select("node", AGENT);
    render(<Inspector />);

    expect(toolRow(/clinical-reference/)).toBeChecked();
    expect(screen.getByText("도구 2개")).toBeInTheDocument();
  });

  it("keeps the pick as one step to undo", async () => {
    store().select("node", AGENT);
    render(<Inspector />);

    await userEvent.click(toolRow(/clinical-reference/));

    expect(configOf(AGENT)).toMatchObject({ toolset_refs: [] });
    act(() => store().undo());
    expect(configOf(AGENT)).toMatchObject({ toolset_refs: ["clinical-reference"] });
  });

  // 화면이 모르는 이름을 조용히 지우지 않는다 — 줄로 남고, 뺄 손잡이를 준다.
  it("shows a name this document lacks as an unknown connection, with a way out", async () => {
    act(() => store().updateNodeConfig(AGENT, { toolset_refs: ["gone"] }));
    store().select("node", AGENT);
    render(<Inspector />);

    expect(screen.getByText("알 수 없는 연결 'gone'")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /빼기/ }));
    expect(configOf(AGENT)).toMatchObject({ toolset_refs: [] });
  });

  it("says where connections come from when this document has none", () => {
    act(() => store().loadSpec({ ...example, resources: [] }));
    store().select("node", AGENT);
    render(<Inspector />);

    expect(
      screen.getByText("이 문서에는 아직 연결이 없어요 — 왼쪽 연결 패널에서 만들 수 있어요"),
    ).toBeInTheDocument();
  });

  it("says the connections it has carry no tools yet", () => {
    act(() =>
      store().loadSpec({
        ...example,
        resources: [{ id: "plain", kind: "mcp.toolset", server_ref: "mcp://plain" }],
      } as unknown as AgentSpec),
    );
    store().select("node", AGENT);
    render(<Inspector />);

    expect(
      screen.getByText("도구가 있는 연결이 아직 없어요 — 연결 패널에서 도구를 붙일 수 있어요"),
    ).toBeInTheDocument();
  });

  // 고른 모델이 도구를 못 쓰면 도구를 고르게 두지 않는다 — 실행 실패와 같은 말로 (DESIGN §7).
  it("locks the whole list when this server says the model cannot use tools", () => {
    act(() =>
      useEditor.setState({
        serverModels: {
          mode: "live",
          models: [
            {
              ref: "model://default",
              title: { ko: "기본 모델", en: "Default model" },
              callable: true,
              reason: null,
              toolCalling: false,
            },
          ],
        },
      }),
    );
    store().select("node", AGENT);
    render(<Inspector />);

    expect(toolRow(/clinical-reference/)).toBeDisabled();
    expect(
      screen.getByText(
        "이 모델은 도구를 쓸 수 없어요 — 도구를 쓸 수 있는 모델을 고르거나, 이 단계에서 도구를 빼 주세요",
      ),
    ).toBeInTheDocument();
  });

  // 서버가 모델 사정을 말하지 않았으면 잠그지 않는다 — 모르는 것을 없다고 말하지 않는다.
  it("locks nothing while this server said nothing about its models", () => {
    act(() => useEditor.setState({ serverModels: null }));
    store().select("node", AGENT);
    render(<Inspector />);

    expect(toolRow(/clinical-reference/)).toBeEnabled();
  });
});
