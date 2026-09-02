// 로그아웃은 캔버스 모서리의 고정 버튼이 아니라 문서 메뉴의 마지막 항목이다
// (DESIGN §1 우하 / §7 doc-card 로그아웃) — 미니맵과 겹치던 자리를 비운다.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionGate } from "../src/SessionGate";
import { DocCard } from "../src/shell/DocCard";
import { useEditor } from "../src/store/editor";

let calls: string[] = [];

/** 열려 있는 세션을 답하는 서버 대역 — 로그아웃 부탁은 어디로 갔는지 적어 둔다. */
function serveSession() {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, csrf_token: "csrf" }),
    } as unknown as Response;
  });
}

async function openMenuInSession() {
  render(
    <SessionGate>
      <DocCard />
    </SessionGate>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
}

beforeEach(() => {
  useEditor.setState({ spec: null, nodes: [], edges: [] });
  serveSession();
});

afterEach(() => vi.unstubAllGlobals());

describe("이 자리를 떠나는 길", () => {
  it("문서 메뉴의 마지막 항목이 로그아웃이다", async () => {
    await openMenuInSession();

    const items = screen
      .getAllByRole("button")
      .filter((button) => button.className.startsWith("doc-menu__"));
    expect(items.at(-1)).toHaveTextContent("로그아웃");
  });

  it("그 항목을 누르면 서버에 세션을 닫아 달라고 하고 로그인 화면으로 돌아간다", async () => {
    await openMenuInSession();

    const item = screen.getByRole("button", { name: "로그아웃" });
    expect(item).toHaveClass("doc-menu__logout");
    await userEvent.click(item);

    await waitFor(() =>
      expect(screen.getByLabelText("관리자 비밀번호")).toBeInTheDocument(),
    );
    expect(calls.filter((call) => call.includes("/auth/logout"))).toEqual([
      "POST http://localhost:8000/auth/logout",
    ]);
  });

  it("세션을 모르는 화면에는 그 항목이 없다 — 눌러도 아무 일 없는 자리를 두지 않는다", async () => {
    render(<DocCard />);

    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));

    expect(screen.queryByRole("button", { name: "로그아웃" })).toBeNull();
  });
});
