// 도구 노드의 연결·도구는 외워서 적는 것이 아니라 문서가 가진 것 중에서 고른다 (API_TOOLS P2a).
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec, ResourceBinding } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { Inspector } from "../src/inspector/Inspector";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

const TOOL_NODE = "tool";
const CLINICAL = "clinical-reference";
const BILLING = "billing-api";
const TOOL_EDGE = "tool-agent";

const clinical: ResourceBinding = {
  id: CLINICAL,
  kind: "mcp.toolset",
  server_ref: "mcp://clinical-reference",
  approval_policy: "read_only_auto",
  tools: [
    {
      name: "lookup",
      plain_description: { ko: "찾아본다.", en: "Looks it up." },
      input_schema: { type: "object" },
      output_schema: { type: "string" },
      timeout_ms: 5000,
      call: { transport: "mcp", remote_name: "lookup" },
    },
    {
      name: "listing",
      plain_description: { ko: "목록을 준다.", en: "Gives a list." },
      input_schema: { type: "object" },
      output_schema: { type: "array" },
      timeout_ms: 5000,
      call: { transport: "mcp", remote_name: "listing" },
    },
  ],
};

const billing: ResourceBinding = {
  id: BILLING,
  kind: "mcp.toolset",
  server_ref: "mcp://billing",
  approval_policy: "read_only_auto",
  tools: [
    {
      name: "charge",
      plain_description: { ko: "값을 청구한다.", en: "Charges for it." },
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      timeout_ms: 5000,
      call: { transport: "mcp", remote_name: "charge" },
    },
  ],
};

/** 도구 노드 하나와 그 결과를 받는 연결 하나를 얹은 문서. */
function withTools(
  config: Record<string, unknown>,
  resources: ResourceBinding[] = [clinical, billing],
): AgentSpec {
  return {
    ...example,
    resources,
    nodes: [
      ...example.nodes,
      { id: TOOL_NODE, type: "tool.mcp", position: { x: 0, y: 0 }, config },
    ],
    edges: [
      ...example.edges,
      {
        id: TOOL_EDGE,
        kind: "data",
        source: { node: TOOL_NODE, port: "result" },
        target: { node: "clinical-agent", port: "messages" },
      },
    ],
  };
}

function store() {
  return useEditor.getState();
}

function open(spec: AgentSpec) {
  act(() => {
    store().loadSpec(spec);
    store().select("node", TOOL_NODE);
  });
  render(<Inspector />);
}

function connectionField() {
  return screen.getByRole("combobox", { name: /^사용할 연결( \*)?$/ });
}

function toolField() {
  return screen.getByRole("combobox", { name: /^실행할 도구 이름( \*)?$/ });
}

function configOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.spec.config;
}

function portsOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.ports;
}

beforeEach(() => {
  act(() => setLocale("ko"));
});

describe("the connection a tool node runs on", () => {
  it("offers the connections this document holds", () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));

    expect(connectionField().tagName).toBe("SELECT");
    expect(within(connectionField()).getByRole("option", { name: CLINICAL })).toBeInTheDocument();
    expect(within(connectionField()).getByRole("option", { name: BILLING })).toBeInTheDocument();
    expect(connectionField()).toHaveValue(CLINICAL);
  });

  it("saves the connection that was picked", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));

    await userEvent.selectOptions(connectionField(), BILLING);

    expect(configOf(TOOL_NODE)).toMatchObject({ resource_ref: BILLING });
  });

  // 목록에 없는 값도 잃지 않는다 — 틀렸다는 말은 필드 오류와 노드 뱃지가 이미 한다.
  it("keeps a saved name the list does not know, in the typing state", () => {
    open(withTools({ resource_ref: "gone-away", tool_name: "listing" }));

    expect(connectionField()).toHaveValue("__type_it_myself__");
    expect(screen.getByRole("textbox", { name: /^사용할 연결( \*)?$/ })).toHaveValue(
      "gone-away",
    );
  });

  // 이름이 문서에 없는 것과 아직 안 고른 것은 다른 일이다 — 없는 이유를 말하지 않는다.
  it("does not tell the tool field to wait when a connection is already written", () => {
    open(withTools({ resource_ref: "gone-away", tool_name: "listing" }));

    expect(toolField()).not.toBeDisabled();
    expect(screen.queryByText("먼저 연결을 고르세요")).not.toBeInTheDocument();
    // 적혀 있던 도구 이름은 그대로 보이고, 고칠 수도 있다.
    expect(screen.getByRole("textbox", { name: /^실행할 도구 이름( \*)?$/ })).toHaveValue(
      "listing",
    );
  });

  it("says why the list is empty instead of handing over an empty one", () => {
    open(withTools({ resource_ref: "", tool_name: "" }, []));

    expect(
      screen.getByText("이 문서에는 아직 연결이 없어요 — 왼쪽 연결 패널에서 만들 수 있어요"),
    ).toBeInTheDocument();
    // 목록이 비어도 칸은 살아 있다 — 손으로 적는 길까지 막지는 않는다.
    expect(connectionField()).not.toBeDisabled();
    expect(portsOf(TOOL_NODE)?.inputs.input).toBeDefined();
  });

  it("counts one pick as one step to undo, never merged with typing", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));
    const steps = store().undoStack.length;

    await userEvent.selectOptions(connectionField(), BILLING);
    act(() => store().undo());

    expect(store().undoStack).toHaveLength(steps);
    expect(configOf(TOOL_NODE)).toMatchObject({ resource_ref: CLINICAL });
  });

  // 이어진 고름은 합쳐지지 않는다 — 두 번 고르면 두 걸음이고, 한 번 되돌리면 한 번만 되돌아온다.
  it("gives every pick in a row its own step", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));
    const steps = store().undoStack.length;

    await userEvent.selectOptions(connectionField(), BILLING);
    await userEvent.selectOptions(connectionField(), CLINICAL);
    expect(store().undoStack).toHaveLength(steps + 2);

    act(() => store().undo());
    expect(configOf(TOOL_NODE)).toMatchObject({ resource_ref: BILLING });
  });
});

describe("the tool a tool node runs", () => {
  it("offers the tools the chosen connection holds, and explains each one", () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));

    const option = within(toolField()).getByRole("option", { name: "lookup" });
    expect(option).toHaveAttribute("title", "찾아본다.");
    expect(within(toolField()).getByRole("option", { name: "listing" })).toBeInTheDocument();
    expect(within(toolField()).queryByRole("option", { name: "charge" })).toBeNull();
  });

  it("follows the connection when it changes", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));

    await userEvent.selectOptions(connectionField(), BILLING);

    expect(within(toolField()).getByRole("option", { name: "charge" })).toBeInTheDocument();
    expect(within(toolField()).queryByRole("option", { name: "lookup" })).toBeNull();
  });

  // 고른 것은 연결이지 도구가 아니다 — 목록이 밖에서 바뀌었다고 손을 끌고 가지 않는다.
  it("keeps the cursor on the connection when the tool list changes under it", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));
    connectionField().focus();

    await userEvent.selectOptions(connectionField(), BILLING);

    expect(connectionField()).toHaveFocus();
    // 새 목록에 없는 도구 이름도 지우지 않는다 — 적는 자리에 그대로 남는다.
    expect(screen.getByRole("textbox", { name: /^실행할 도구 이름( \*)?$/ })).toHaveValue(
      "listing",
    );
  });

  it("waits for a connection, and says so", () => {
    open(withTools({ resource_ref: "", tool_name: "" }));

    expect(toolField()).toBeDisabled();
    expect(screen.getByText("먼저 연결을 고르세요")).toBeInTheDocument();
  });

  it("says when the chosen connection carries no tools at all", () => {
    open(
      withTools({ resource_ref: CLINICAL, tool_name: "" }, [{ ...clinical, tools: [] }]),
    );

    expect(screen.getByText("이 연결에는 아직 도구가 없어요")).toBeInTheDocument();
  });

  it("speaks the same reasons in english", () => {
    act(() => setLocale("en"));
    open(withTools({ resource_ref: "", tool_name: "" }, []));

    expect(
      screen.getByText(
        "This document has no connections yet — the connections panel on the left makes one",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick a connection first")).toBeInTheDocument();
  });
});

describe("what picking a tool does on the canvas", () => {
  it("redraws the ports in the shape of the tool that was picked", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));

    await userEvent.selectOptions(toolField(), "lookup");

    expect(portsOf(TOOL_NODE)?.outputs.result.schema).toEqual({ type: "string" });
    expect(portsOf(TOOL_NODE)?.inputs.input.schema).toEqual({ type: "object" });
  });

  // 도구를 바꾸면 값의 모양이 달라진다 — 그래서 못 쓰게 된 연결을 조용히 남기지 않는다.
  it("tells the user about a connection the new shape breaks", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "listing" }));
    expect(store().edges.some((edge) => edge.id === TOOL_EDGE)).toBe(true);

    await userEvent.selectOptions(toolField(), "lookup");

    expect(store().edges.some((edge) => edge.id === TOOL_EDGE)).toBe(false);
    expect(store().notice).not.toBeNull();
  });

  it("leaves connections the new shape still fits alone", async () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "lookup" }));

    await userEvent.selectOptions(toolField(), "listing");

    expect(store().edges.some((edge) => edge.id === TOOL_EDGE)).toBe(true);
    expect(store().notice).toBeNull();
  });
});

describe("fields no marker points at", () => {
  it("stay the plain boxes they were", () => {
    act(() => {
      store().loadSpec(withTools({ resource_ref: CLINICAL, tool_name: "lookup" }));
      store().select("node", "clinical-agent");
    });
    render(<Inspector />);

    // 이름 자리(prompt_ref)와 연결 목록(toolset_refs)은 마커가 없다 — 지금 그대로다.
    expect(
      screen.getByRole("textbox", { name: /^지시문 이름 \(고급\)( \*)?$/ }).tagName,
    ).toBe("INPUT");
    expect(
      screen.getByRole("textbox", { name: /^쓸 수 있는 연결( \*)?$/ }).tagName,
    ).toBe("TEXTAREA");
  });
});

describe("while a run is being watched", () => {
  it("locks the pickers with the rest of the form — no new lock of its own", () => {
    open(withTools({ resource_ref: CLINICAL, tool_name: "lookup" }));

    act(() =>
      useEditor.setState({
        runEvents: [
          {
            seq: 1,
            run_id: "run_tool",
            spec_revision: "rev",
            timestamp: "2026-08-28T00:00:00.000Z",
            event_type: "run.started",
            payload: {},
          },
        ],
      }),
    );

    expect(connectionField()).toBeDisabled();
    expect(toolField()).toBeDisabled();
    act(() => useEditor.setState({ runEvents: [] }));
  });
});
