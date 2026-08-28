// 시험해 보기 — 케이스 만들기·전부 실행·결과 카드 (DESIGN §7 eval-panel 네 블록). EVAL-3 E1~E12.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { EvalPanel } from "../src/eval/EvalPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EvalBatch } from "../src/generated/eval_batch";
import type { EvalCase } from "../src/generated/eval_case";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";
import { serveSaves } from "./fakeRunServer";
import { serveEval } from "./fakeEvalServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 입력 노드가 이 값을 받는 문서 — eval-case-form의 "넣을 값"이 여기서 나온다. */
const graphAsking = {
  ...example,
  nodes: example.nodes.map((node) =>
    node.type === "core.input" ? { ...node, config: { bindings: { question: "input.question" } } } : node,
  ),
} as AgentSpec;

beforeEach(() => {
  act(() => setLocale("ko"));
  useEditor.setState({
    spec: null,
    savedSpec: null,
    nodes: [],
    edges: [],
    evalPanelOpen: false,
    evalUseJudge: false,
    dataset: null,
    datasetSynced: null,
    datasetKnownOnServer: false,
    caseDraft: null,
    lastDeletedCase: null,
    batchId: null,
    batchStatus: "idle",
    batch: null,
    evalAdvanced: false,
    evalBatchHistory: null,
    evalBatchHistoryLoading: false,
    evalBatchHistoryFailure: null,
    evalSelectedHistoryId: null,
  });
  serveSaves();
});

async function openPanel(spec: AgentSpec = graphAsking) {
  store().loadSpec(spec);
  const eval_ = serveEval();
  act(() => store().enterEvalMode());
  await act(() => Promise.resolve());
  render(<EvalPanel />);
  return eval_;
}

function runButton() {
  return screen.getByRole("button", { name: "전부 실행해 보기" });
}

describe("E1·E2 — 패널 진입과 문서 미저장 상태", () => {
  it("케이스는 있어도 문서를 저장하지 않았으면 전부 실행 버튼이 잠기지만 케이스 편집은 열려 있다", async () => {
    await openPanel();
    // 케이스 편집이 열려 있다는 것부터 본다 — 문서 저장과 무관하게 항상 된다.
    const addCase = screen.getByRole("button", { name: "첫 시험 만들기" });
    expect(addCase).toBeEnabled();
    await userEvent.click(addCase);
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    // 케이스는 생겼지만 문서는 여전히 저장 안 됐다 — 이제 이유는 "저장"이어야 한다.
    expect(runButton()).toBeDisabled();
    expect(runButton()).toHaveAttribute("title", expect.stringContaining("저장"));
  });
});

describe("E3 — 케이스 0", () => {
  it("초대 한 줄과 첫 시험 만들기가 뜨고, 첫 케이스가 생기면 사라진다", async () => {
    await openPanel();

    expect(screen.getByText("무엇을 넣으면 무슨 말이 나와야 하는지 하나 적어 봐요")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    expect(
      screen.queryByText("무엇을 넣으면 무슨 말이 나와야 하는지 하나 적어 봐요"),
    ).not.toBeInTheDocument();
  });
});

describe("E4 — 케이스 폼 왕복", () => {
  it("제목·넣을 값·문구·횟수가 기본 1·1로 왕복된다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));

    expect(screen.getByLabelText(/question/i)).toBeInTheDocument();
    expect(screen.getByLabelText("몇 번 돌려볼까요")).toHaveValue(1);
    expect(screen.getByLabelText("몇 번 통과해야 합격일까요")).toHaveValue(1);

    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/question/i), "안녕하세요");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕\n반갑");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    const saved = store().dataset?.cases?.[0];
    expect(saved?.title).toBe("인사");
    expect(saved?.input).toEqual({ question: "안녕하세요" });
    expect(saved?.expected_phrases).toEqual(["안녕", "반갑"]);
    expect(saved?.runs_per_case).toBe(1);
    expect(saved?.passes_needed).toBe(1);
  });
});

describe("E5 — 통과 수가 횟수를 넘으면 그릴 때부터 막는다", () => {
  it("저장 버튼이 잠기고 이유를 말한다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    const runs = screen.getByLabelText("몇 번 돌려볼까요");
    const passes = screen.getByLabelText("몇 번 통과해야 합격일까요");
    await userEvent.clear(runs);
    await userEvent.type(runs, "1");
    await userEvent.clear(passes);
    await userEvent.type(passes, "3");

    expect(
      screen.getByText("통과해야 할 횟수가 돌리는 횟수보다 많을 수 없어요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  // 독립 리뷰 M2 — 폼의 로컬 판정이 draftIsSavable을 반쪽만 베끼면 이 갈래를 놓친다(ge=1).
  it("횟수가 0보다 작으면(음수) 그릴 때부터 막고 이유를 말한다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    const passes = screen.getByLabelText("몇 번 통과해야 합격일까요");
    await userEvent.clear(passes);
    await userEvent.type(passes, "-1");

    expect(screen.getByText("횟수는 최소 1번이어야 해요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  // 독립 리뷰 2라운드 minor 2 — 빈 칸도 이유 없이 잠기지 않는다.
  it("횟수 칸을 비워도 이유를 말한다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    await userEvent.clear(screen.getByLabelText("몇 번 통과해야 합격일까요"));

    expect(screen.getByText("횟수는 최소 1번이어야 해요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toHaveAttribute(
      "title",
      "횟수는 최소 1번이어야 해요",
    );
  });
});

describe("E6 — 저장 상태 캡션", () => {
  it("저장 안 된 변경 → 저장했어요로 바뀐다 (404 → POST 생성 경로)", async () => {
    const server = await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    expect(screen.getByText("저장했어요")).toBeInTheDocument();
    expect(server.datasets.size).toBe(1);
  });

  // 독립 리뷰 M1 — 초안 편집이 dirty 판정에 안 들어가면 캡션이 거짓말을 한다.
  it("저장된 케이스를 다시 고치면 캡션이 곧바로 '저장 안 된 변경'으로 돌아간다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
    expect(screen.getByText("저장했어요")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/제목/), "!");

    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();
    expect(screen.queryByText("저장했어요")).not.toBeInTheDocument();
  });

  it("서버가 저장을 물리면 danger 알림으로 말하고 초안은 화면에 남는다", async () => {
    const server = await openPanel();
    server.refuseSave({ key: "eval.save.failed", params: { reason: "그래프에 손볼 곳" } });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    expect(screen.getByText("그래프에 손볼 곳", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText(/제목/)).toHaveValue("인사");
  });

  // 독립 리뷰 2라운드 minor 1 — 물린 저장이 "저장했어요"로 거짓말하면 안 된다(datasetSynced 고정).
  it("서버가 저장을 물리면 캡션은 '저장했어요'로 돌아가지 않는다", async () => {
    const server = await openPanel();
    server.refuseSave({ key: "eval.save.failed", params: { reason: "그래프에 손볼 곳" } });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    expect(screen.queryByText("저장했어요")).not.toBeInTheDocument();
    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();
  });
});

describe("E7·E8·E9 — 전부 실행하고 결과 카드·pill이 갱신된다", () => {
  async function savedCase() {
    const server = await openPanel();
    await act(async () => {
      await store().saveSpec();
    });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
    return server;
  }

  it("아직 안 돌렸으면 pill이 그렇게 말한다", async () => {
    await savedCase();
    expect(screen.getByText("아직 돌려 보지 않았어요")).toBeInTheDocument();
  });

  it("돌리는 동안 primary가 잠기고, 완결되면 카드와 pill이 통과로 바뀐다", async () => {
    const server = await savedCase();
    const caseId = store().dataset?.cases?.[0]?.id as string;

    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    expect(runButton()).toBeDisabled();
    expect(runButton()).toHaveAttribute("title", "지금 돌려 보는 중이에요");
    // 서버가 부분 진행을 주지 않는 동안(all-or-nothing) 개수를 보여주지 않는다 — 거짓 정밀도 금지.
    expect(screen.getByText("확인하는 중이에요")).toBeInTheDocument();

    const batchId = store().batchId as string;
    const batch: EvalBatch = {
      id: batchId,
      dataset_id: store().dataset?.id as string,
      spec_id: store().spec?.id as string,
      spec_revision: store().savedSpec?.revision as string,
      started_at: new Date().toISOString(),
      results: [
        {
          case_id: caseId,
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: true,
          attempts: [{ run_id: "r1", passed: true, output_text: "안녕하세요" }],
        },
      ],
    };
    server.completeBatch(batchId, batch);
    await act(() => server.flushPoll());

    expect(screen.getByText("1개 중 1개 통과했어요")).toBeInTheDocument();
    expect(runButton()).toBeEnabled();
    expect(store().evalSelectedHistoryId).toBe(batchId);
    const card = screen.getByText("인사").closest(".eval-case-card");
    expect(card).toHaveAttribute("data-state", "passed");
  });

  it("일부만 통과하면 몇 번 중 몇 번 됐는지와 다음 걸음을 말한다", async () => {
    const server = await savedCase();
    const caseId = store().dataset?.cases?.[0]?.id as string;
    await userEvent.click(runButton());
    await act(() => Promise.resolve());
    const batchId = store().batchId as string;

    server.completeBatch(batchId, {
      id: batchId,
      dataset_id: store().dataset?.id as string,
      spec_id: store().spec?.id as string,
      spec_revision: store().savedSpec?.revision as string,
      started_at: new Date().toISOString(),
      results: [
        {
          case_id: caseId,
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: false,
          attempts: [
            { run_id: "r1", passed: false, output_text: "몰라요" },
            { run_id: "r2", passed: true, output_text: "안녕하세요" },
            { run_id: "r3", passed: false, output_text: "글쎄요" },
          ],
        },
      ],
    });
    await act(() => server.flushPoll());

    expect(screen.getByText("3번 중 1번만 통과")).toBeInTheDocument();
    expect(
      screen.getByText("기대한 말이 답에 없었어요 — 카드를 눌러 무엇이 나왔는지 봐요"),
    ).toBeInTheDocument();
    expect(screen.getByText("1개가 아직 못 갔어요")).toBeInTheDocument();
  });

  // 독립 리뷰 M3 — 실패 캡션의 "카드를 눌러 무엇이 나왔는지 봐요"는 이 토막이 지킨다.
  it("펼치면 마지막 회차의 실제 답과 ring이 함께 선다", async () => {
    const server = await savedCase();
    const caseId = store().dataset?.cases?.[0]?.id as string;
    await userEvent.click(runButton());
    await act(() => Promise.resolve());
    const batchId = store().batchId as string;
    server.completeBatch(batchId, {
      id: batchId,
      dataset_id: store().dataset?.id as string,
      spec_id: store().spec?.id as string,
      spec_revision: store().savedSpec?.revision as string,
      started_at: new Date().toISOString(),
      results: [
        {
          case_id: caseId,
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: false,
          attempts: [
            { run_id: "r1", passed: false, output_text: "몰라요" },
            { run_id: "r2", passed: false, output_text: "마지막 답" },
          ],
        },
      ],
    });
    await act(() => server.flushPoll());

    // savedCase()가 저장 직후의 폼을 이미 펼쳐 둔 채로 남겨 둔다 — 다시 누를 필요가 없다.
    expect(screen.getByRole("button", { name: /인사/ })).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText("실제로 나온 답")).toBeInTheDocument();
    expect(screen.getByText("마지막 답")).toBeInTheDocument();
    const card = screen.getByText("인사").closest(".eval-case-card") as HTMLElement;
    expect(card.className).toContain("eval-case-card--selected");

    // 독립 리뷰 2라운드 minor 4 — 결과 토막이 편집 폼보다 먼저 온다(방금 돌린 결과가 먼저 보인다).
    const resultLabel = screen.getByText("실제로 나온 답");
    const titleField = screen.getByLabelText(/제목/);
    expect(
      resultLabel.compareDocumentPosition(titleField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("마지막 회차의 답이 빈 문자열이면 '답이 없었어요'라고 말한다", async () => {
    const server = await savedCase();
    const caseId = store().dataset?.cases?.[0]?.id as string;
    await userEvent.click(runButton());
    await act(() => Promise.resolve());
    const batchId = store().batchId as string;
    server.completeBatch(batchId, {
      id: batchId,
      dataset_id: store().dataset?.id as string,
      spec_id: store().spec?.id as string,
      spec_revision: store().savedSpec?.revision as string,
      started_at: new Date().toISOString(),
      results: [
        {
          case_id: caseId,
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: false,
          attempts: [{ run_id: "r1", passed: false, output_text: "" }],
        },
      ],
    });
    await act(() => server.flushPoll());

    expect(screen.getByText("답이 없었어요")).toBeInTheDocument();
  });
});

describe("EVAL-4A — Advanced 결과·이력 경계", () => {
  it("Advanced에서 회차 기술 정보와 배치 이력을 함께 보여 준다", async () => {
    await openPanel();
    const evalCase: EvalCase = { id: "case-advanced", title: "고급 케이스", input: {}, expected_phrases: ["ok"] };
    const batch: EvalBatch = {
      id: "batch-advanced",
      dataset_id: store().dataset?.id as string,
      spec_id: "spec",
      spec_revision: "rev",
      started_at: "2026-08-20T03:04:05.000Z",
      results: [{
        case_id: evalCase.id,
        evaluator: "expected_phrases",
        evaluator_version: "v2",
        passed: true,
        attempts: [{ run_id: "run-advanced", passed: true, output_text: "ok" }],
      }],
    };
    act(() => useEditor.setState({
      dataset: { ...store().dataset!, cases: [evalCase] },
      batch,
      batchId: batch.id,
      batchStatus: "completed",
      evalAdvanced: true,
      evalBatchHistory: { batches: [{ id: batch.id, started_at: batch.started_at, case_count: 1, passed_count: 1 }], has_more: true },
    }));
    act(() => store().expandCase(evalCase.id));

    expect(screen.getByText("회차 1")).toBeInTheDocument();
    expect(screen.getByText("expected_phrases · v2 · run-advanced")).toBeInTheDocument();
    expect(screen.getByText("더 지난 실행이 있어요")).toBeInTheDocument();
  });

  it("history가 아직 없고 로딩·실패도 아니면 빈 상태를 말한다", async () => {
    await openPanel();
    act(() => useEditor.setState({ evalAdvanced: true, evalBatchHistory: null }));
    expect(screen.getByText("아직 지난 실행이 없어요")).toBeInTheDocument();
  });

  it("배치 시각은 현재 언어로 표시하고 잘못된 시각은 빈칸으로 숨기지 않는다", async () => {
    await openPanel();
    act(() => useEditor.setState({
      evalAdvanced: true,
      evalBatchHistory: { batches: [{ id: "bad-date", started_at: "not-a-date", case_count: 0, passed_count: 0 }], has_more: false },
    }));
    expect(screen.getByText("언제 저장했는지 몰라요")).toBeInTheDocument();
  });
});

describe("E10 — 배치가 배경에서 실패하면 쉬운 말과 다음 걸음만 말한다", () => {
  it("서버 원문을 보여주지 않는다", async () => {
    const server = await openPanel();
    await act(async () => {
      await store().saveSpec();
    });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());

    await userEvent.click(runButton());
    await act(() => Promise.resolve());
    const batchId = store().batchId as string;
    server.failBatch(batchId);
    await act(() => server.flushPoll());

    expect(screen.getByText("돌리다가 문제가 생겼어요 — 다시 시도해 보세요")).toBeInTheDocument();
  });

  // 독립 리뷰 minor — 서버에 한 번 못 닿은 것은 배치 실패가 아니다. eval.poll.offline을 살린다.
  it("한 번 못 닿아도 배치는 죽지 않고, 닿지 못했다는 알림만 한다", async () => {
    const server = await openPanel();
    await act(async () => {
      await store().saveSpec();
    });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    // 다음 한 번은 서버에 닿지 못했다고 해 둔다 — 그래도 폴러는 스스로 다음 걸음을 다시 잡는다.
    useEditor.setState({ fetchBatch: async () => ({ failure: { key: "eval.poll.offline" } }) });
    await act(() => server.flushPoll());

    expect(store().batchStatus).toBe("running");
    expect(
      screen.getByText("서버에 닿지 못해 소식을 듣지 못했어요"),
    ).toBeInTheDocument();
  });

  it("서버가 배치 시작 자체를 물리면 danger 알림으로 말한다", async () => {
    const server = await openPanel();
    await act(async () => {
      await store().saveSpec();
    });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
    server.refuseBatchStart({ key: "eval.run.notSaved" });

    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    expect(store().batchStatus).toBe("failed");
    expect(screen.getByText("서버에 이 시험 묶음이나 그래프가 없어요", { exact: false })).toBeInTheDocument();
  });
});

describe("E11 — 케이스 지우기는 되묻지 않고, 되돌릴 수 있다", () => {
  /** 케이스 카드를 펼쳐 채우고 저장한다 — 이미 펼친 새 폼이 있을 때만 부른다. */
  async function fillAndSave(title: string, expected: string) {
    await userEvent.type(screen.getByLabelText(/제목/), title);
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), expected);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
  }

  it("확인 없이 바로 지우고, 카드가 있던 그 자리에서 되돌리기를 누르면 살아난다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await fillAndSave("인사", "안녕");

    await userEvent.click(screen.getByRole("button", { name: "이 시험 지우기" }));
    await act(() => Promise.resolve());

    expect(screen.queryByText("인사")).not.toBeInTheDocument();
    // DESIGN §7 eval-case-card 갱신본: 정확히 '지웠어요 — 되돌리기' 한 줄 — 카드 자리에.
    expect(screen.getByText("지웠어요 —")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    await act(() => Promise.resolve());

    expect(screen.getByText("인사")).toBeInTheDocument();
    expect(screen.queryByText("지웠어요 —")).not.toBeInTheDocument();
  });

  it("되돌리기 줄은 지운 케이스가 있던 자리에 선다 — 남은 케이스 사이에 끼어든다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await fillAndSave("가", "하나");
    await userEvent.click(screen.getByRole("button", { name: "새 시험 만들기" }));
    await fillAndSave("나", "둘");

    // "가"(0번째)를 편다(케이스마다 지우기 단추는 펼쳤을 때만 나온다) — 지우면 되돌리기 줄이
    // "나"보다 앞선, 원래 있던 그 자리에 남는다.
    await userEvent.click(screen.getByRole("button", { name: "가" }));
    await userEvent.click(screen.getByRole("button", { name: "이 시험 지우기" }));
    await act(() => Promise.resolve());

    const cards = screen.getByText("나").closest(".eval-panel__cases") as HTMLElement;
    const rowNames = [...cards.children].map((child) =>
      child.textContent?.includes("지웠어요") ? "restore" : child.textContent,
    );
    expect(rowNames[0]).toBe("restore");
  });

  it("갈아탄다 — 새 지우기가 오면 이전 되돌리기 자리는 사라지고 되돌릴 수 없다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await fillAndSave("가", "하나");
    await userEvent.click(screen.getByRole("button", { name: "새 시험 만들기" }));
    await fillAndSave("나", "둘");

    await userEvent.click(screen.getByRole("button", { name: "가" }));
    await userEvent.click(screen.getByRole("button", { name: "이 시험 지우기" })); // "가" 지우기
    await act(() => Promise.resolve());
    await userEvent.click(screen.getByRole("button", { name: "나" }));
    await userEvent.click(screen.getByRole("button", { name: "이 시험 지우기" })); // "나" 지우기 — 갈아탄다
    await act(() => Promise.resolve());

    // 되돌리기는 언제나 하나 — 되돌려도 "나"만 살아나고 "가"는 영영 사라졌다.
    expect(screen.getAllByText("지웠어요 —")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    await act(() => Promise.resolve());

    expect(screen.getByText("나")).toBeInTheDocument();
    expect(screen.queryByText("가")).not.toBeInTheDocument();
  });
});

describe("E12 — 문구는 전부 사전을 거친다", () => {
  it("내부 명칭(expected_phrases)이 화면에 노출되지 않는다", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));

    expect(screen.queryByText(/expected_phrases/)).not.toBeInTheDocument();
  });

  it("영어 로케일에서도 같은 문구가 사전을 거쳐 나온다", async () => {
    act(() => setLocale("en"));
    await openPanel();

    expect(screen.getByRole("button", { name: "Run them all" })).toBeInTheDocument();
    expect(screen.getByText("Write down what you put in and what should come back")).toBeInTheDocument();
  });

  // 독립 리뷰 M4 — 설명 문구는 messages.ts 손 복제가 아니라 카탈로그가 원천이어야 한다.
  it("'들어있어야 하는 말' 설명은 카탈로그의 plain_description 그대로다", async () => {
    const { evaluatorCatalog, EXPECTED_PHRASES_EVALUATOR } = await import(
      "../src/eval/evaluatorCatalog"
    );
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));

    expect(
      screen.getByText(evaluatorCatalog[EXPECTED_PHRASES_EVALUATOR].plain_description.ko),
    ).toBeInTheDocument();
  });
});


describe("EVAL-5 — 심판 모델까지 쓰기 체크 (DESIGN §7 eval-panel)", () => {
  async function savedCase() {
    const server = await openPanel();
    await act(async () => {
      await store().saveSpec();
    });
    await userEvent.click(screen.getByRole("button", { name: "첫 시험 만들기" }));
    await userEvent.type(screen.getByLabelText(/제목/), "인사");
    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await act(() => Promise.resolve());
    return server;
  }

  function judgeCheck() {
    return screen.getByRole("checkbox", { name: /심판 모델까지 쓰기/ });
  }

  it("값이 드는 층은 기본으로 꺼져 있고, 켜지 않으면 청하지도 않는다", async () => {
    const server = await savedCase();

    expect(judgeCheck()).not.toBeChecked();

    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    expect(server.startedWith).toEqual([expect.objectContaining({ useJudge: false })]);
  });

  it("켜고 돌리면 이번 실행에만 심판까지 쓰겠다고 실어 보낸다", async () => {
    const server = await savedCase();

    await userEvent.click(judgeCheck());
    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    expect(server.startedWith).toEqual([expect.objectContaining({ useJudge: true })]);
    // 이 선택은 실행의 속성이다 — 시험 묶음에 저장되지 않는다.
    expect(JSON.stringify(store().dataset)).not.toContain("judge");
  });

  it("비용이 든다는 사실을 누르기 전에 체크 옆에서 읽는다", async () => {
    await savedCase();

    expect(screen.getByText("모델 호출 비용이 들어요")).toBeInTheDocument();
  });

  it("영어로 봐도 같은 말을 한다", async () => {
    await savedCase();
    act(() => setLocale("en"));

    expect(screen.getByRole("checkbox", { name: /Use the judge model too/ })).toBeInTheDocument();
    expect(screen.getByText("This calls a model, so it costs money")).toBeInTheDocument();
  });

  it("돌리는 중에는 바꿀 수 없다 — 도는 배치의 값을 뒤늦게 바꾸는 척하지 않는다", async () => {
    await savedCase();

    await userEvent.click(runButton());
    await act(() => Promise.resolve());

    expect(judgeCheck()).toBeDisabled();
    // 비활성은 이유를 말한다 — 실행 primary와 같은 까닭이면 같은 말이다.
    expect(judgeCheck().closest("label")).toHaveAttribute("title", "지금 돌려 보는 중이에요");
  });
});
