// 언어를 바꾸면 화면의 글이 함께 바뀐다 — 대표 표면마다 한 번씩 확인한다.
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Palette } from "../src/canvas/Palette";
import type { AgentSpec } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { Inspector } from "../src/inspector/Inspector";
import { EventList } from "../src/run/EventList";
import { ModeSegment } from "../src/shell/ModeSegment";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function readEnglish() {
  act(() => setLocale("en"));
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runOffsetMs: 0, isPlaying: false });
  useEditor.getState().loadSpec(example);
});

describe("언어를 바꾸면", () => {
  it("팔레트의 노드 이름과 설명이 영어로 바뀐다", () => {
    render(<Palette />);
    expect(screen.getByText("AI 에이전트")).toBeInTheDocument();

    readEnglish();

    expect(screen.getByText("AI agent")).toBeInTheDocument();
    expect(screen.queryByText("AI 에이전트")).not.toBeInTheDocument();
    expect(screen.getByText("The model works with tools to build an answer.")).toBeInTheDocument();
  });

  it("모드 세그먼트의 버튼 이름이 영어로 바뀐다", () => {
    render(<ModeSegment />);
    expect(screen.getByRole("button", { name: "만들기" })).toBeInTheDocument();

    readEnglish();

    expect(screen.getByRole("button", { name: "Build" })).toBeInTheDocument();
  });

  it("설정 카드의 라벨과 설명이 영어로 바뀐다", () => {
    useEditor.getState().select("node", "clinical-agent");
    render(<Inspector />);
    expect(screen.getByLabelText(/사용할 모델/)).toBeInTheDocument();

    readEnglish();

    expect(screen.getByLabelText(/Model to use/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI agent" })).toBeInTheDocument();
  });

  it("실행 기록의 문장이 영어로 바뀐다", async () => {
    await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00.000Z") });
    render(<EventList />);
    expect(screen.getByText("실행을 시작했다")).toBeInTheDocument();

    readEnglish();

    expect(screen.getByText("The run started")).toBeInTheDocument();
  });
});
