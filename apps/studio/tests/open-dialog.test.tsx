// 문서 열기 대화상자 (DESIGN §7 open-dialog) — 목록·빈 목록·못 불러옴·되묻기·키보드.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { DocListOutcome, SaveOutcome, SavedDoc } from "../src/api/specs";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const listed: SavedDoc[] = [
  {
    id: "draft-abc12345",
    name: null,
    version: 3,
    revision: `sha256:${"b".repeat(64)}`,
    saved_at: "2026-08-01T12:31:00Z",
  },
  {
    id: example.id,
    name: "임상 도우미",
    version: 2,
    revision: `sha256:${"a".repeat(64)}`,
    saved_at: "2026-08-01T12:20:00Z",
  },
];

function serverWith(documents: SavedDoc[] = listed, hasMore = false) {
  return {
    fetchDocs: async () => ({ documents, hasMore }),
    fetchDoc: async (id: string): Promise<SaveOutcome> => ({
      saved: asServerAnswer({ ...example, id, name: "다른 문서", version: 4 }),
      issues: [],
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

/** 문서 메뉴를 펼치고 '열기'를 누른다 — 사용자가 실제로 걷는 길. */
async function openTheList() {
  await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "열기" }));
  return screen.findByRole("dialog", { name: "어떤 문서를 열까요" });
}

function docRows() {
  return within(screen.getByRole("dialog")).getAllByRole("button", { name: /판/ });
}

beforeEach(() => {
  useEditor.setState({ docList: null, savedSpec: null, feedbackNotice: null, saving: false });
  store().loadSpec(example);
  useEditor.setState({
    ...serverWith(),
    address: { docId: () => null, remember: () => undefined },
    // 보고 있는 문서는 이미 서버에 맡겨 둔 그대로다 — 잃을 것이 없는 자리에서 시작한다.
    savedSpec: store().exportSpec(),
  });
});

describe("문서 목록이 보이는 모습", () => {
  it("초기 응답 전에는 빈 화면 대신 기다림을 말한다", async () => {
    const pending = deferred<DocListOutcome>();
    useEditor.setState({ fetchDocs: () => pending.promise });
    render(<App />);

    const dialog = await openTheList();

    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "문서 목록을 불러오는 중이에요",
    );
    expect(within(dialog).queryByRole("button", { name: /판/ })).toBeNull();

    pending.resolve({ documents: listed, hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()).toHaveLength(2);
  });

  it("다시 불러오는 동안에는 기존 rows와 기다림을 함께 보여준다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    let reloading!: Promise<void>;
    act(() => {
      reloading = store().reloadDocList();
    });

    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "문서 목록을 불러오는 중이에요",
    );
    expect(docRows()).toHaveLength(2);

    pending.resolve({ documents: [listed[1]], hasMore: false });
    await act(async () => {
      await reloading;
    });

    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(docRows()).toHaveLength(1);
  });

  it("성공 목록의 새로고침 버튼은 기존 rows를 둔 채 다시 묻는다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    const reload = within(dialog).getByRole("button", {
      name: "문서 목록 새로 불러오기",
    });
    expect(reload).not.toBeDisabled();

    await userEvent.click(reload);

    expect(reload).toBeDisabled();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "문서 목록을 불러오는 중이에요",
    );
    expect(docRows()).toHaveLength(2);

    pending.resolve({ documents: [listed[1]], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));

    expect(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    ).not.toBeDisabled();
    expect(docRows()).toHaveLength(1);
  });

  it("새로고침을 키보드로 시작하면 첫 줄에 손을 옮기고 pending 중 줄도 조작한다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    const reload = within(dialog).getByRole("button", {
      name: "문서 목록 새로 불러오기",
    });
    reload.focus();
    await userEvent.keyboard("{Enter}");

    expect(reload).toBeDisabled();
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(docRows()[1]).toHaveFocus();

    pending.resolve({ documents: listed, hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
  });

  it("빈 목록을 새로고침하면 disabled 버튼 대신 닫기에 손을 옮긴다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: [], hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    const reload = within(dialog).getByRole("button", {
      name: "문서 목록 새로 불러오기",
    });
    const close = within(dialog).getByRole("button", { name: "닫기" });
    await userEvent.click(reload);

    expect(reload).toBeDisabled();
    await waitFor(() => expect(close).toHaveFocus());

    pending.resolve({ documents: [], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
  });

  it("새 목록에 pending 중 고른 줄이 남으면 그 줄에 손을 유지한다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(docRows()[1]).toHaveFocus();

    pending.resolve({ documents: [listed[1]], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()[0]).toHaveFocus();
  });

  it("새로고침 pending 중 닫기에 Tab하면 성공 뒤에도 그 선택을 덮지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    const close = within(dialog).getByRole("button", { name: "닫기" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();

    pending.resolve({ documents: listed, hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(close).toHaveFocus();
  });

  it("새로고침 pending 중 dialog 밖에 손을 옮기면 성공 뒤에도 그 선택을 덮지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());

    const outside = screen.getByRole("button", { name: /문서 메뉴/ });
    outside.focus();
    expect(outside).toHaveFocus();

    pending.resolve({ documents: [listed[1]], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(outside).toHaveFocus();
  });

  it("새 목록에서 pending 중 고른 줄이 사라지면 새 첫 줄로 fallback한다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(docRows()[1]).toHaveFocus();

    pending.resolve({ documents: [listed[0]], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()[0]).toHaveFocus();
  });

  it("빈 목록에서 새로고침 결과가 생기면 첫 줄에 손을 옮긴다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: [], hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    const close = within(dialog).getByRole("button", { name: "닫기" });
    await waitFor(() => expect(close).toHaveFocus());

    pending.resolve({ documents: listed, hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()[0]).toHaveFocus();
  });

  it("새 목록이 비면 새로고침 뒤 닫기로 손을 옮긴다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    const close = within(dialog).getByRole("button", { name: "닫기" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    pending.resolve({ documents: [], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));

    expect(close).toHaveFocus();
  });

  it("빈 목록에서 다시 새로고침하면 이전 줄이 아닌 새 첫 줄에 손을 옮긴다", async () => {
    const emptyPending = deferred<DocListOutcome>();
    const rowsPending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        if (calls === 1) return { documents: listed, hasMore: false };
        if (calls === 2) return emptyPending.promise;
        return rowsPending.promise;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(docRows()[1]).toHaveFocus();

    emptyPending.resolve({ documents: [], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    const close = within(dialog).getByRole("button", { name: "닫기" });
    expect(close).toHaveFocus();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(close).toHaveFocus());
    rowsPending.resolve({ documents: listed, hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()[0]).toHaveFocus();
  });

  it("새로고침과 닫기는 header에서 Tab과 Shift+Tab으로 오갈 수 있다", async () => {
    render(<App />);

    const dialog = await openTheList();
    const reload = within(dialog).getByRole("button", {
      name: "문서 목록 새로 불러오기",
    });
    const close = within(dialog).getByRole("button", { name: "닫기" });

    close.focus();
    await userEvent.tab({ shift: true });
    expect(reload).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
  });

  it("새로고침 실패 뒤 기존 다시 해보기로 목록을 회복한다", async () => {
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1
          ? { documents: listed, hasMore: false }
          : { failure: msg("open.list.offline") };
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("서버에 닿지 못했어요"),
    );
    expect(
      within(dialog).getByRole("button", { name: "다시 해보기" }),
    ).toBeInTheDocument();

    useEditor.setState({
      fetchDocs: async () => ({ documents: [listed[1]], hasMore: false }),
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "다시 해보기" }));

    await waitFor(() => expect(docRows()).toHaveLength(1));
    expect(dialog).toHaveAttribute("aria-busy", "false");
  });

  it("새로고침 실패 뒤 다시 해보기로 손을 옮긴다", async () => {
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1
          ? { documents: listed, hasMore: false }
          : { failure: msg("open.list.offline") };
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );

    const retry = await within(dialog).findByRole("button", { name: "다시 해보기" });
    expect(retry).toHaveFocus();
  });

  it("다시 해보기가 pending이면 닫기, 성공이면 첫 줄, 재실패면 다시 해보기로 간다", async () => {
    const retryPending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        if (calls === 1) return { documents: listed, hasMore: false };
        if (calls === 2) return { failure: msg("open.list.offline") };
        if (calls === 3) return retryPending.promise;
        return { failure: msg("open.list.offline") };
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    const retry = await within(dialog).findByRole("button", { name: "다시 해보기" });
    expect(retry).toHaveFocus();

    retry.focus();
    await userEvent.keyboard("{Enter}");
    const close = within(dialog).getByRole("button", { name: "닫기" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog).toHaveAttribute("aria-busy", "true");

    retryPending.resolve({ documents: [listed[1]], hasMore: false });
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "false"));
    expect(docRows()[0]).toHaveFocus();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    const failedAgain = await within(dialog).findByRole("button", { name: "다시 해보기" });
    expect(failedAgain).toHaveFocus();
  });

  it("새로고침 pending 중 줄에서 Enter한 뒤 Esc로 닫으면 늦은 응답도 손을 되살리지 않는다", async () => {
    const listPending = deferred<DocListOutcome>();
    const docPending = deferred<SaveOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : listPending.promise;
      },
      fetchDoc: async () => docPending.promise,
    });
    let reloading!: Promise<void>;
    const reloadDocList = store().reloadDocList;
    useEditor.setState({
      reloadDocList: () => {
        reloading = reloadDocList();
        return reloading;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const menu = screen.getByRole("button", { name: /문서 메뉴/ });
    expect(menu).toHaveFocus();

    await act(async () => {
      listPending.resolve({ documents: listed, hasMore: false });
      docPending.resolve({ failure: msg("open.notFound") });
      await reloading;
      await docPending.promise;
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(menu).toHaveFocus();
  });

  it("새로고침 중 닫으면 늦은 응답이 목록을 되살리지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
    });
    let reloading!: Promise<void>;
    const reloadDocList = store().reloadDocList;
    useEditor.setState({
      reloadDocList: () => {
        reloading = reloadDocList();
        return reloading;
      },
    });
    render(<App />);

    const dialog = await openTheList();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    expect(reloading).toBeDefined();
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();

    await act(async () => {
      pending.resolve({ documents: [listed[1]], hasMore: false });
      await reloading;
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("문서 목록을 불러오는 중이에요")).toBeNull();
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();
  });

  it("서버가 준 차례대로 이름과 마지막 저장을 보여준다", async () => {
    render(<App />);

    const dialog = await openTheList();

    const rows = docRows();
    expect(rows).toHaveLength(2);
    // 이름이 없는 문서는 id 대신 쉬운 말로 부른다 — 내부 값은 화면에 쓰지 않는다.
    expect(rows[0]).toHaveTextContent("이름 없는 문서");
    expect(rows[0]).not.toHaveTextContent("draft-abc12345");
    expect(rows[0]).toHaveTextContent("3번째 판");
    expect(rows[1]).toHaveTextContent("임상 도우미");
    expect(dialog).toBeInTheDocument();
  });

  it("지금 보는 문서에는 그렇다고 뱃지를 붙인다", async () => {
    render(<App />);

    await openTheList();

    expect(docRows()[1]).toHaveTextContent("지금 보는 문서");
    expect(docRows()[0]).not.toHaveTextContent("지금 보는 문서");
  });

  it("아직 저장한 문서가 없으면 그렇게 말한다 — 빈 화면으로 두지 않는다", async () => {
    useEditor.setState(serverWith([]));
    render(<App />);

    await openTheList();

    expect(screen.getByText(/아직 저장한 문서가 없어요/)).toBeInTheDocument();
  });

  it("서버가 잘렸다고 하면 오래된 문서가 남아 있다고 말한다 — 조용히 자르지 않는다", async () => {
    useEditor.setState(serverWith(listed, true));
    render(<App />);

    await openTheList();

    expect(screen.getByText("오래된 문서는 아직 보여줄 수 없어요")).toBeInTheDocument();
  });

  it("목록이 길어도 잘리지 않았으면 그런 말을 하지 않는다 — 없는 것을 있다고 하지 않는다", async () => {
    const many = Array.from({ length: 200 }, (_, at) => ({
      ...listed[0],
      id: `doc-${at}`,
    }));
    useEditor.setState(serverWith(many, false));
    render(<App />);

    await openTheList();

    expect(screen.queryByText("오래된 문서는 아직 보여줄 수 없어요")).toBeNull();
  });
});

describe("목록을 못 불러왔을 때", () => {
  it("까닭을 말하고 다시 해볼 길을 남긴다 — 대화상자는 닫지 않는다", async () => {
    useEditor.setState({ fetchDocs: async () => ({ failure: msg("open.list.offline") }) });
    render(<App />);

    await openTheList();

    expect(screen.getByRole("alert")).toHaveTextContent("서버에 닿지 못했어요");
    expect(screen.getByRole("button", { name: "다시 해보기" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("다시 해보기를 누르면 이번에는 목록이 온다", async () => {
    useEditor.setState({ fetchDocs: async () => ({ failure: msg("open.list.offline") }) });
    render(<App />);
    await openTheList();
    useEditor.setState(serverWith());

    await userEvent.click(screen.getByRole("button", { name: "다시 해보기" }));

    await waitFor(() => expect(docRows()).toHaveLength(2));
  });
});

describe("목록에서 문서를 여는 일", () => {
  it("한 줄을 누르면 그 문서가 열리고 대화상자는 닫힌다", async () => {
    render(<App />);
    await openTheList();

    await userEvent.click(docRows()[0]);

    await waitFor(() => expect(store().spec?.id).toBe("draft-abc12345"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("한 번도 저장하지 않은 초안도 같은 카드 안에서 되묻는다", async () => {
    useEditor.setState({ spec: null, nodes: [], edges: [], tray: [], savedSpec: null });
    render(<App />);
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    await openTheList();

    await userEvent.click(docRows()[0]);

    expect(screen.getByRole("dialog")).toHaveTextContent("아직 저장하지 않은 작업이 있어요");
    expect(store().nodes).toHaveLength(1);
  });

  it("저장하지 않은 작업이 있으면 같은 카드 안에서 되묻는다", async () => {
    render(<App />);
    useEditor.setState({ savedSpec: example });
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    await openTheList();

    await userEvent.click(docRows()[0]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("아직 저장하지 않은 작업이 있어요");
    expect(within(dialog).getByRole("button", { name: "저장하고 열기" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /그냥 열기/ })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "돌아가기" })).toBeVisible();
    expect(store().spec?.id).toBe(example.id);
  });

  it("새로고침 중 보존된 줄을 고르면 늦은 응답 뒤에도 되묻기를 유지한다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
      savedSpec: example,
    });
    let reloading!: Promise<void>;
    const reloadDocList = store().reloadDocList;
    useEditor.setState({
      reloadDocList: () => {
        reloading = reloadDocList();
        return reloading;
      },
    });
    render(<App />);
    const dialog = await openTheList();
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));

    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(reloading).toBeDefined();

    await userEvent.click(docRows()[0]);
    expect(dialog).toHaveTextContent("아직 저장하지 않은 작업이 있어요");

    await act(async () => {
      pending.resolve({ documents: [listed[1]], hasMore: false });
      await reloading;
    });

    expect(dialog).toHaveTextContent("아직 저장하지 않은 작업이 있어요");
    expect(within(dialog).getByRole("button", { name: "돌아가기" })).toBeVisible();
  });

  it("새로고침 중 고른 문서가 실패해도 늦은 목록 응답 뒤에는 busy가 남지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: async () => {
        calls += 1;
        return calls === 1 ? { documents: listed, hasMore: false } : pending.promise;
      },
      fetchDoc: async () => ({ failure: msg("open.notFound") }),
    });
    let reloading!: Promise<void>;
    const reloadDocList = store().reloadDocList;
    useEditor.setState({
      reloadDocList: () => {
        reloading = reloadDocList();
        return reloading;
      },
    });
    render(<App />);
    const dialog = await openTheList();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "문서 목록 새로 불러오기" }),
    );
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(reloading).toBeDefined();

    await userEvent.click(docRows()[0]);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "그 문서를 찾지 못했어요",
      ),
    );
    expect(within(dialog).getByRole("button", { name: "다시 해보기" })).not.toHaveFocus();

    await act(async () => {
      pending.resolve({ documents: [listed[1]], hasMore: false });
      await reloading;
    });

    expect(within(dialog).getByRole("alert")).toHaveTextContent("그 문서를 찾지 못했어요");
    expect(dialog).toHaveAttribute("aria-busy", "false");
    expect(within(dialog).queryByRole("status")).toBeNull();
  });

  it("지금 보는 문서를 다시 고를 때도 최신 판을 확인할 수 있게 되묻는다", async () => {
    render(<App />);
    useEditor.setState({ savedSpec: example });
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    await openTheList();

    await userEvent.click(docRows()[1]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("아직 저장하지 않은 작업이 있어요");
    expect(within(dialog).getByRole("button", { name: "돌아가기" })).toBeVisible();
    expect(store().spec?.id).toBe(example.id);
  });

  it("돌아가기를 누르면 목록으로 돌아온다", async () => {
    render(<App />);
    useEditor.setState({ savedSpec: example });
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    await openTheList();
    await userEvent.click(docRows()[0]);

    await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(docRows()).toHaveLength(2);
  });

  it("그냥 열기는 저장하지 않고 연다", async () => {
    render(<App />);
    useEditor.setState({ savedSpec: example });
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    await openTheList();
    await userEvent.click(docRows()[0]);

    await userEvent.click(screen.getByRole("button", { name: /그냥 열기/ }));

    await waitFor(() => expect(store().spec?.id).toBe("draft-abc12345"));
  });
});

describe("새로고침하고 돌아온 자리", () => {
  it("주소가 가리키던 문서가 다시 열린다", async () => {
    useEditor.setState({
      spec: null,
      nodes: [],
      edges: [],
      savedSpec: null,
      address: { docId: () => "draft-abc12345", remember: () => undefined },
    });

    render(<App />);

    await waitFor(() => expect(store().spec?.id).toBe("draft-abc12345"));
    expect(screen.getByText("저장했어요 · 4번째 판")).toBeInTheDocument();
  });

  it("모르는 문서를 가리키면 빈 초안으로 시작하고 한 번 알린다", async () => {
    const forgotten: string[] = [];
    useEditor.setState({
      spec: null,
      nodes: [],
      edges: [],
      savedSpec: null,
      fetchDoc: async () => ({ failure: msg("open.notFound") }),
      address: {
        docId: () => "nowhere",
        remember: (id: string | null) => forgotten.push(String(id)),
      },
    });

    render(<App />);

    expect(await screen.findByText("그 문서를 찾지 못했어요")).toBeInTheDocument();
    expect(store().spec).toBeNull();
    expect(forgotten).toEqual(["null"]);
  });
});

describe("키보드만으로 문서를 여는 길", () => {
  it("열리면 첫 줄에 손이 놓이고 위아래로 옮겨 다닌다", async () => {
    render(<App />);
    await openTheList();

    await waitFor(() => expect(docRows()[0]).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}");
    expect(docRows()[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(docRows()[0]).toHaveFocus();
  });

  it("Enter로 고른 문서를 연다", async () => {
    render(<App />);
    await openTheList();
    await waitFor(() => expect(docRows()[0]).toHaveFocus());

    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(store().spec?.id).toBe("draft-abc12345"));
  });

  it("Esc로 닫으면 손은 문서 메뉴 버튼으로 돌아온다", async () => {
    render(<App />);
    await openTheList();
    await waitFor(() => expect(docRows()[0]).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();
  });

  it("목록 응답 전에 Esc로 닫으면 늦은 응답도 대화상자를 되살리지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    useEditor.setState({ fetchDocs: () => pending.promise });
    render(<App />);

    await openTheList();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      pending.resolve({ documents: listed, hasMore: false });
      await pending.promise;
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
