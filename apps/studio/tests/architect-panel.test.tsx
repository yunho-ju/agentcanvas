import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { useEditor } from "../src/store/editor";
import { draftWithAnEmptySettingFixture, providerDraftFixture } from "./architect-fixtures";

beforeEach(() => useEditor.setState({ spec: null, nodes: [], edges: [], architectMode: "guided", architectRequest: "", architectDraft: null, architectReview: null, architectError: null, architectLoading: false, requestArchitectDraft: providerDraftFixture, firstStepsDismissed: false }));

describe("ArchitectPanel", () => {
  it("shows guided input, handles blank input, and supports skip", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "AI 설계 도우미" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "직접 조립할게요" }));
    expect(screen.queryByRole("heading", { name: "AI 설계 도우미" })).not.toBeInTheDocument();
    expect(screen.getByText("첫 그래프, 네 걸음이면 돼요")).toBeInTheDocument();
  });

  it("keeps the canvas empty while reviewing and returns to input", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "무엇을 만들까요" }), "make an answer");
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    expect(await screen.findByRole("heading", { name: "초안 확인" })).toBeInTheDocument();
    expect(useEditor.getState().nodes).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "다시 적기" }));
    expect(screen.getByRole("heading", { name: "AI 설계 도우미" })).toBeInTheDocument();
  });

  it("says nothing is left to fill when the draft arrives with every setting filled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "무엇을 만들까요" }), "make an answer");
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));

    expect(await screen.findByText("채워야 할 칸: 0개")).toBeInTheDocument();
    expect(screen.queryByText("적용한 뒤 노드를 눌러 채우면 돼요")).not.toBeInTheDocument();
    expect(screen.getByText("채워야 할 칸: 0개").closest("[data-tone]")).toHaveAttribute("data-tone", "ok");
  });

  it("counts the settings still empty and says they can be filled after applying", async () => {
    useEditor.setState({ requestArchitectDraft: draftWithAnEmptySettingFixture });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "무엇을 만들까요" }), "make an answer");
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));

    expect(await screen.findByText("채워야 할 칸: 1개")).toBeInTheDocument();
    expect(screen.getByText("적용한 뒤 노드를 눌러 채우면 돼요")).toBeInTheDocument();
    expect(screen.getByText("채워야 할 칸: 1개").closest("[data-tone]")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByRole("button", { name: "캔버스에 적용" })).toBeEnabled();
  });

  it("closes the architect surface only after approval", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole("textbox", { name: "무엇을 만들까요" }), "make an answer");
    await user.click(screen.getByRole("button", { name: "초안 만들기" }));
    await user.click(await screen.findByRole("button", { name: "캔버스에 적용" }));

    expect(screen.queryByRole("heading", { name: "초안 확인" })).not.toBeInTheDocument();
    expect(useEditor.getState().architectMode).toBe("closed");
    expect(useEditor.getState().nodes).toHaveLength(4);
  });
});
