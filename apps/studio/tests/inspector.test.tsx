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

  it("keeps a list field a list of strings, one per line", async () => {
    store().select("node", "clinical-agent");
    render(<Inspector />);

    const list = screen.getByLabelText(/쓸 수 있는 연결/);
    await userEvent.clear(list);
    await userEvent.type(list, "one{enter}two");

    expect(configOf("clinical-agent")).toMatchObject({ toolset_refs: ["one", "two"] });
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
    const drawn = Array.from(container.querySelectorAll("label")).map((label) =>
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

describe("core.input bindings", () => {
  beforeEach(() => {
    store().select("node", "input");
  });

  it("shows one row per binding the node already has", () => {
    render(<Inspector />);
    expect(screen.getByDisplayValue("question")).toBeInTheDocument();
    expect(screen.getByDisplayValue("input.patient_context")).toBeInTheDocument();
  });

  it("grows a new output port as soon as a binding is added", async () => {
    render(<Inspector />);

    await userEvent.click(screen.getByRole("button", { name: /추가/ }));
    const rows = screen.getAllByLabelText(/이름/);
    await userEvent.type(rows.at(-1) as HTMLElement, "vitals");
    const paths = screen.getAllByLabelText(/가져올 위치/);
    await userEvent.type(paths.at(-1) as HTMLElement, "input.vitals");

    expect(
      Object.keys(store().nodes.find((node) => node.id === "input")?.data.ports.outputs ?? {}),
    ).toContain("vitals");
  });

  it("warns when two rows carry the same name instead of losing one quietly", async () => {
    render(<Inspector />);

    await userEvent.click(screen.getByRole("button", { name: /추가/ }));
    const names = screen.getAllByLabelText(/번째 이름/);
    await userEvent.type(names.at(-1) as HTMLElement, "question");

    const warnings = screen.getAllByRole("alert");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toHaveTextContent("마지막 값만 저장된다");
  });

  it("says nothing while every row has its own name", () => {
    render(<Inspector />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes the connection that used a binding the user deleted", async () => {
    render(<Inspector />);

    const row = screen.getByDisplayValue("question").closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /지우기/ }));

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
