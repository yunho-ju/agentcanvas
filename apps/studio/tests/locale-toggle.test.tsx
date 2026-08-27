// 화면의 언어는 사용자가 정한다 — 한 번 고르면 다음에 와도 그 말로 맞이한다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocaleToggle } from "../src/i18n/LocaleToggle";
import { getLocale, readStoredLocale } from "../src/i18n/localeStore";

describe("언어 고르기", () => {
  it("한국어 화면에서는 영어로 바꾸자고 말한다", () => {
    render(<LocaleToggle />);

    expect(screen.getByRole("button", { name: "English로 보기" })).toBeInTheDocument();
  });

  it("한 번 누르면 화면이 영어가 되고, 버튼은 돌아갈 길을 말한다", async () => {
    render(<LocaleToggle />);

    await userEvent.click(screen.getByRole("button", { name: "English로 보기" }));

    expect(getLocale()).toBe("en");
    expect(screen.getByRole("button", { name: "Read this in Korean" })).toBeInTheDocument();
  });

  it("고른 언어를 기억한다", async () => {
    render(<LocaleToggle />);

    await userEvent.click(screen.getByRole("button", { name: "English로 보기" }));

    expect(readStoredLocale()).toBe("en");
  });

  it("읽는 기계에게 이 글이 무슨 말인지 알린다", async () => {
    render(<LocaleToggle />);
    expect(document.documentElement.lang).toBe("ko");

    await userEvent.click(screen.getByRole("button", { name: "English로 보기" }));

    expect(document.documentElement.lang).toBe("en");
  });
});
