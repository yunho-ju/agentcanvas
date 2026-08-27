// 빈 상자 앞에서 무엇을 적을지 모르는 사람은 시작 글을 골라 채우고 고쳐 쓴다 (P3-7).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { Inspector } from "../src/inspector/Inspector";
import { INSTRUCTION_CATALOG } from "../src/registry/instructionCatalog";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";
const SUMMARIZE = INSTRUCTION_CATALOG.summarize;
const CLASSIFY = INSTRUCTION_CATALOG.classify;

function store() {
  return useEditor.getState();
}

function configOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.spec.config;
}

function writeInstruction(text: string) {
  store().updateNodeConfig(AGENT, { ...configOf(AGENT), instruction: text });
}

function presetField() {
  return screen.getByRole("combobox", { name: "지시문 프리셋" });
}

function instructionBox() {
  return screen.getByRole("textbox", { name: /^지시문( \*)?$/ });
}

beforeEach(() => {
  store().loadSpec(example);
  store().select("node", AGENT);
});

describe("the instruction field", () => {
  it("offers the presets the catalog holds, above the box they fill", () => {
    render(<Inspector />);

    expect(presetField().tagName).toBe("SELECT");
    expect(instructionBox().tagName).toBe("TEXTAREA");
    expect(
      within(presetField()).getByRole("option", { name: SUMMARIZE.title.ko }),
    ).toBeInTheDocument();
    expect(
      presetField().compareDocumentPosition(instructionBox()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a resting placeholder nobody can pick", () => {
    render(<Inspector />);

    const placeholder = within(presetField()).getByRole("option", {
      name: "이런 일을 시켜 보세요…",
    });
    expect(placeholder).toBeDisabled();
    expect(presetField()).toHaveValue("");
  });

  it("fills the box with the words of the preset that was picked", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(presetField(), SUMMARIZE.title.ko);

    expect(instructionBox()).toHaveValue(SUMMARIZE.text.ko);
    expect(configOf(AGENT)).toMatchObject({ instruction: SUMMARIZE.text.ko });
  });

  it("gives the fill one step to undo, bringing back what was written before", async () => {
    writeInstruction("내가 쓰던 글");
    render(<Inspector />);

    await userEvent.selectOptions(presetField(), SUMMARIZE.title.ko);
    act(() => store().undo());

    expect(configOf(AGENT)).toMatchObject({ instruction: "내가 쓰던 글" });
  });

  it("puts the cursor in the box right after filling it — it is there to be edited", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(presetField(), SUMMARIZE.title.ko);

    expect(instructionBox()).toHaveFocus();
  });

  // 키보드로 훑는 환경(Windows 셀렉트)은 화살표만으로 change가 난다 — 포인터 없이 change만 흉내 낸다.
  it("keeps the cursor on the picker while arrow keys are still browsing", () => {
    render(<Inspector />);
    const field = presetField();
    field.focus();

    fireEvent.change(field, { target: { value: SUMMARIZE.id } });

    // 훑는 중에도 채움은 일어난다 — undo가 지키므로 무섭지 않다.
    expect(configOf(AGENT)).toMatchObject({ instruction: SUMMARIZE.text.ko });
    expect(field).toHaveFocus();
  });

  it("moves the cursor to the box when the browsing ends with Enter", () => {
    render(<Inspector />);
    const field = presetField();
    field.focus();
    fireEvent.change(field, { target: { value: SUMMARIZE.id } });

    fireEvent.keyDown(field, { key: "Enter" });

    expect(instructionBox()).toHaveFocus();
  });

  it("goes back to resting after filling — it is an action, not a value", async () => {
    render(<Inspector />);

    await userEvent.selectOptions(presetField(), CLASSIFY.title.ko);

    expect(presetField()).toHaveValue("");
  });

  it("stacks no step to undo when the words are already the ones picked", async () => {
    render(<Inspector />);
    await userEvent.selectOptions(presetField(), SUMMARIZE.title.ko);
    const steps = store().undoStack.length;

    await userEvent.selectOptions(presetField(), SUMMARIZE.title.ko);

    expect(store().undoStack).toHaveLength(steps);
    expect(configOf(AGENT)).toMatchObject({ instruction: SUMMARIZE.text.ko });
  });

  it("invites the empty box to say what this step should do", () => {
    render(<Inspector />);

    expect(instructionBox()).toHaveAttribute(
      "placeholder",
      "이 단계가 무엇을 하면 되는지 적어요 — 위에서 골라 시작해도 돼요",
    );
  });

  it("speaks the same invitation in english", () => {
    act(() => setLocale("en"));
    render(<Inspector />);

    expect(
      screen.getByRole("textbox", { name: /^Instructions( \*)?$/ }),
    ).toHaveAttribute(
      "placeholder",
      "Write what this step should do — or pick a start above",
    );
    act(() => setLocale("ko"));
  });

  it("names the same presets in english, and fills in english too", async () => {
    act(() => setLocale("en"));
    render(<Inspector />);

    const field = screen.getByRole("combobox", { name: "Instructions presets" });
    expect(
      within(field).getByRole("option", { name: SUMMARIZE.title.en }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(field, SUMMARIZE.title.en);

    expect(configOf(AGENT)).toMatchObject({ instruction: SUMMARIZE.text.en });
    act(() => setLocale("ko"));
  });
});

describe("a long text field that is not an instruction", () => {
  it("stays a plain box — no presets are offered for it", () => {
    store().loadSpec({
      ...example,
      nodes: [{ id: "odd", type: "custom.note", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    useEditor.setState({
      nodes: store().nodes.map((node) => ({
        ...node,
        selected: true,
        data: {
          ...node.data,
          nodeType: {
            type: "custom.note",
            version: "1.0",
            runtime: "custom",
            display_name: { ko: "메모 노드", en: "Note node" },
            plain_description: { ko: "설명", en: "A description" },
            ports: { inputs: [], outputs: [] },
            config_schema: {
              type: "object",
              properties: {
                note: { type: "string", format: "textarea", title: "Note" },
              },
            },
          },
        },
      })),
    });
    render(<Inspector />);

    expect(screen.getByRole("textbox", { name: "Note" }).tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Note" })).not.toHaveAttribute(
      "placeholder",
    );
  });
});
