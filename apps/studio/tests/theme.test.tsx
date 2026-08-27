// 화면의 밝기는 사용자가 정한다 — 처음에는 시스템을 따르고, 원하면 직접 고른다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../src/theme/ThemeToggle";

function systemPrefers(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("밝기 고르기", () => {
  it("사용자가 고르기 전에는 아무것도 덮어쓰지 않고 시스템을 따른다", () => {
    systemPrefers(true);

    render(<ThemeToggle />);

    // 화면에 아무 표시도 남기지 않는다 — 시스템이 도중에 바뀌면 그대로 따라간다.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(screen.getByRole("button", { name: "밝게 보기" })).toBeInTheDocument();
  });

  it("어두운 화면에서는 밝게 바꾸자고 말한다", async () => {
    systemPrefers(true);
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "밝게 보기" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "어둡게 보기" })).toBeInTheDocument();
  });

  it("밝은 화면에서 한 번 누르면 어두워진다", async () => {
    systemPrefers(false);
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "어둡게 보기" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
