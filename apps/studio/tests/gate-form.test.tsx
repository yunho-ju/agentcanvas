// 사람이 밸브 앞에서 값을 적어 넘기는 자리 (DESIGN §7 gate-card 승인 폼).
// 무엇을 물을지는 화면이 정하지 않는다: 노드가 가리킨 ref를 카탈로그가 풀어 준 형식 그대로다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReactFlowProvider } from "@xyflow/react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { NodeCard } from "../src/canvas/NodeCard";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { AgentNodeData } from "../src/graph/serialize";
import { setLocale } from "../src/i18n/localeStore";
import type { SchemaDef } from "../src/registry/schemaCatalog";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import { isRunning } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

const GATE = "human-gate";
const KNOWN = "schema://answer-review@1";
const DEMANDING = "schema://demanding@1";
const EVERY_KIND = "schema://every-kind@1";
const UNREADABLE = "schema://unreadable@1";
const NOTHING_TO_ASK = "schema://nothing-to-ask@1";

/**
 * 카탈로그에 아직 없는 형식들 — 새 형식이 와도 카드 코드는 그대로여야 한다(OCP).
 * 계약이 들고 있는 형식은 그대로 두고, 이 시험이 쓰는 것만 얹는다.
 */
const EXTRA: Record<string, SchemaDef> = {
  [DEMANDING]: {
    ref: DEMANDING,
    title: { ko: "꼭 적어야 하는 양식", en: "Form that must be filled" },
    schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          title: "Reason",
          "x-i18n": { ko: { title: "까닭" } },
        },
      },
      required: ["reason"],
    },
  },
  // 이름은 풀렸지만 그릴 수 있는 항목이 하나도 없는 형식 — 폼이 그려지지 않는다.
  [UNREADABLE]: {
    ref: UNREADABLE,
    title: { ko: "그릴 수 없는 양식", en: "Form we cannot draw" },
    schema: { type: "object" },
  },
  // 읽히기는 하지만 물을 것이 하나도 없는 형식 — 역시 그릴 폼이 없다.
  [NOTHING_TO_ASK]: {
    ref: NOTHING_TO_ASK,
    title: { ko: "물을 것이 없는 양식", en: "Form that asks nothing" },
    schema: { type: "object", properties: {}, required: [] },
  },
  [EVERY_KIND]: {
    ref: EVERY_KIND,
    title: { ko: "여러 가지 양식", en: "Form of many kinds" },
    schema: {
      type: "object",
      properties: {
        agreed: { type: "boolean", title: "Agreed", "x-i18n": { ko: { title: "동의" } } },
        score: { type: "number", title: "Score", "x-i18n": { ko: { title: "점수" } } },
        mood: {
          type: "string",
          enum: ["good", "bad"],
          title: "Mood",
          "x-i18n": { ko: { title: "기분" } },
        },
      },
      required: [],
    },
  },
};

vi.mock("../src/registry/schemaCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/registry/schemaCatalog")>();
  return {
    ...actual,
    resolveSchema: (ref: string) => EXTRA[ref] ?? actual.resolveSchema(ref),
  };
});

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

/** 이 gate가 어떤 양식을 요구하는 그래프인가. */
function graphAsking(ref: string): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.id === GATE ? { ...node, config: { approval_schema_ref: ref } } : node,
    ),
  };
}

function cardData(): AgentNodeData {
  const spec = { id: GATE, type: "control.human_gate", position: { x: 0, y: 0 }, config: {} };
  return { spec, ports: { inputs: {}, outputs: {} }, runStatus: "waiting" };
}

/** 그 양식을 요구하는 밸브 앞에 멈춰 선 카드를 세운다. */
async function heldAskingFor(ref: string) {
  await act(async () => {
    store().loadSpec(graphAsking(ref));
    await runOnServer(trial);
    store().tickRun(EVENT_STEP_MS * 1000);
  });
  return render(
    <ReactFlowProvider>
      <NodeCard id={GATE} data={cardData()} />
    </ReactFlowProvider>,
  );
}

function resumedPayload(): Record<string, unknown> {
  const resumed = store().runEvents.find((event) => event.event_type === "run.resumed");
  if (!resumed) throw new Error("the run never resumed");
  return resumed.payload;
}

beforeEach(() => {
  act(() => setLocale("ko"));
  store().loadSpec(example);
});

describe("the form a gate asks a person to fill in", () => {
  it("asks for what the form describes, in plain words", async () => {
    await heldAskingFor(KNOWN);

    expect(screen.getByLabelText("검토 의견")).toBeInTheDocument();
  });

  it("stands between what the card says and the answers it offers", async () => {
    const { container } = await heldAskingFor(KNOWN);
    const card = container.querySelector(".gate-card");
    const parts = [...(card?.children ?? [])].map((child) => child.className);

    expect(parts.indexOf("gate-card__form")).toBeGreaterThan(
      parts.indexOf("gate-card__body"),
    );
    expect(parts.indexOf("gate-card__form")).toBeLessThan(
      parts.indexOf("gate-card__actions"),
    );
  });

  it("carries what the person wrote along with the approval", async () => {
    await heldAskingFor(KNOWN);

    await userEvent.type(screen.getByLabelText("검토 의견"), "looks right");
    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    expect(resumedPayload().values).toEqual({ comment: "looks right" });
  });

  it("carries nothing when the person had nothing to write", async () => {
    await heldAskingFor(KNOWN);

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    expect(resumedPayload()).not.toHaveProperty("values");
  });

  // 다시 묻는 동안 카드는 그 물음만 한다 — 폼은 물러났다가 돌아온다 (DESIGN §7 새 레이어 금지).
  it("steps the form aside while the card asks again", async () => {
    await heldAskingFor(KNOWN);

    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));

    expect(screen.queryByLabelText("검토 의견")).not.toBeInTheDocument();
  });

  it("keeps what was written while the card asks again about turning it down", async () => {
    await heldAskingFor(KNOWN);
    await userEvent.type(screen.getByLabelText("검토 의견"), "still here");

    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));
    await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.getByLabelText("검토 의견")).toHaveValue("still here");
  });

  it("never shows the inner name of the form it is drawing", async () => {
    const { container } = await heldAskingFor(KNOWN);

    expect(container.textContent).not.toContain("schema://");
  });

  it("says the same thing to a reader of english", async () => {
    await heldAskingFor(KNOWN);

    act(() => setLocale("en"));

    expect(screen.getByLabelText("Review note")).toBeInTheDocument();
  });
});

describe("a gate whose form we cannot find", () => {
  it("says so in plain words instead of showing an empty card", async () => {
    await heldAskingFor("schema://long-gone@9");

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "이 단계가 요구한 입력 양식을 찾지 못했어요 — 입력 없이 승인만 할 수 있어요",
    );
  });

  // 이름은 풀렸어도 그릴 것이 없으면 사람에게는 못 찾은 것과 같다 — 무언의 빈 자리를 남기지 않는다.
  it("says the same when the form it found cannot be drawn", async () => {
    await heldAskingFor(UNREADABLE);

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "이 단계가 요구한 입력 양식을 찾지 못했어요 — 입력 없이 승인만 할 수 있어요",
    );
  });

  it("still lets the person approve a form it cannot draw, with nothing to carry", async () => {
    await heldAskingFor(UNREADABLE);

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    expect(resumedPayload().approved).toBe(true);
    expect(resumedPayload()).not.toHaveProperty("values");
  });

  it("says the same when the form asks for nothing at all", async () => {
    await heldAskingFor(NOTHING_TO_ASK);

    expect(screen.getByRole("dialog")).toHaveTextContent("입력 양식을 찾지 못했어요");
  });

  it("does not print the name it could not find", async () => {
    const { container } = await heldAskingFor("schema://long-gone@9");

    expect(container.textContent).not.toContain("long-gone");
  });

  it("still lets the person approve, with nothing to carry", async () => {
    await heldAskingFor("schema://long-gone@9");

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    expect(resumedPayload().approved).toBe(true);
    expect(resumedPayload()).not.toHaveProperty("values");
  });
});

describe("a form that demands an answer", () => {
  it("marks the field it will not go on without, in words", async () => {
    await heldAskingFor(DEMANDING);

    expect(screen.getByText(/까닭.*필수/)).toBeInTheDocument();
  });

  it("holds the approving answer back and says why", async () => {
    await heldAskingFor(DEMANDING);

    const approve = screen.getByRole("button", { name: "승인하고 계속" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "필수 입력을 채우면 승인할 수 있어요");
  });

  it("never holds back the answers that ask nothing of the person", async () => {
    await heldAskingFor(DEMANDING);

    expect(screen.getByRole("button", { name: "거절하기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "멈춘 채 두기" })).toBeEnabled();
  });

  // 공백 한 칸으로 필수를 지나가지 못한다 — 적지 않은 것과 같다 (실행 입력 카드와 같은 규칙).
  it("does not take a line of nothing but spaces as an answer", async () => {
    await heldAskingFor(DEMANDING);

    await userEvent.type(screen.getByLabelText(/까닭/), "   ");

    expect(screen.getByRole("button", { name: "승인하고 계속" })).toBeDisabled();
  });

  it("lets the approval go the moment the field is filled", async () => {
    await heldAskingFor(DEMANDING);

    await userEvent.type(screen.getByLabelText(/까닭/), "the answer is sound");

    expect(screen.getByRole("button", { name: "승인하고 계속" })).toBeEnabled();
  });
});

// 새 형식이 와도 카드는 고쳐지지 않는다 — 편집기는 registry가 고른다 (OCP).
describe("a form of a kind the card has never seen", () => {
  it("draws every field through the shared control registry", async () => {
    await heldAskingFor(EVERY_KIND);

    expect(screen.getByLabelText("동의")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("점수")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("기분").tagName).toBe("SELECT");
  });
});

// Esc는 카드가 혼자 다루지 않는다 — 물러나는 순서(DESIGN §1)가 맡는다. 그래서 앱을 통째로 세운다.
describe("Escape while the hand is in a form field", () => {
  it("takes the hand off the field and leaves the card standing", async () => {
    const { container } = render(<App />);
    await act(async () => {
      store().loadSpec(graphAsking(KNOWN));
      await runOnServer(trial);
      store().tickRun(EVENT_STEP_MS * 1000);
    });
    const field = container.querySelector<HTMLTextAreaElement>(".gate-card__form textarea");
    if (!field) throw new Error("the held gate card has no form field");
    field.focus();

    await userEvent.keyboard("{Escape}");

    expect(field).not.toHaveFocus();
    expect(container.querySelector(".gate-card")).toBeInTheDocument();
    expect(isRunning(store())).toBe(true);
  });

  it("closes the card on the next Escape — one step at a time", async () => {
    const { container } = render(<App />);
    await act(async () => {
      store().loadSpec(graphAsking(KNOWN));
      await runOnServer(trial);
      store().tickRun(EVENT_STEP_MS * 1000);
    });
    container.querySelector<HTMLTextAreaElement>(".gate-card__form textarea")?.focus();

    await userEvent.keyboard("{Escape}{Escape}");

    expect(container.querySelector(".gate-card")).not.toBeInTheDocument();
    expect(isRunning(store())).toBe(true);
  });
});

// 새 시각을 발명하지 않는다 — 폼은 inspector의 컨트롤 스펙을 그대로 입는다 (DESIGN §7).
describe("what the form is dressed in", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function cssBlock(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("wears the very control the settings card wears", async () => {
    await heldAskingFor(KNOWN);

    expect(screen.getByLabelText("검토 의견")).toHaveClass("control");
  });

  it("stacks its fields with the shared spacing token", () => {
    expect(cssBlock(".gate-card__form")).toContain("flex-direction: column");
    expect(cssBlock(".gate-card__form")).toContain("gap: var(--space-2)");
  });

  it("labels a field the way every other label is drawn", () => {
    expect(cssBlock(".gate-card__label")).toContain("font-size: var(--text-label)");
    expect(cssBlock(".gate-card__label")).toContain("color: var(--ink)");
  });

  it("says the missing form quietly, as a caption", () => {
    expect(cssBlock(".gate-card__no-form")).toContain("font-size: var(--text-caption)");
    expect(cssBlock(".gate-card__no-form")).toContain("color: var(--ink-soft)");
  });

  it("dims the answer it cannot take yet", () => {
    expect(cssBlock(".gate-card__approve:disabled")).toContain("opacity: 0.4");
  });

  // 눌러도 아무 일 없는 버튼이 손짓에 반응하면 그것은 거짓말이다.
  it("does not answer a hand it cannot take", () => {
    expect(app).toContain(".gate-card__approve:hover:not(:disabled)");
    expect(app).toContain(".gate-card__approve:active:not(:disabled)");
    expect(app).not.toContain(".gate-card__approve:hover {");
    expect(app).not.toContain(".gate-card__approve:active {");
  });
});
