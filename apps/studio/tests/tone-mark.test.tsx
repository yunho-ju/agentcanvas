// 같은 세기는 화면 어디에서나 같은 기호로 말한다 (DESIGN §9 색+기호+쉬운 말 3중 표기).
// 기호표가 두 곳에 따로 살면 언젠가 서로 달라진다 — 한 곳에서 온다는 사실을 여기서 고정한다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionHint } from "../src/canvas/ConnectionHint";
import { StatusBar } from "../src/canvas/StatusBar";
import { TONE_MARK } from "../src/canvas/toneMark";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

function markOf(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? "";
}

beforeEach(() => {
  useEditor.setState({ connectionHint: null, feedbackNotice: null, notice: null });
});

describe("세기를 말하는 기호", () => {
  it("셋이 서로 다르다 — 색을 보지 못해도 구분된다", () => {
    expect(new Set(Object.values(TONE_MARK)).size).toBe(
      Object.keys(TONE_MARK).length,
    );
  });

  // 이 카드가 쓰는 두 세기 — 잘 됐다는 말(ok)은 연결 안내가 하지 않는다.
  // 상태 바 안에서도 갈라지지 않는다 — 잘 됐다는 말은 저장 소식이든 편집 소식이든 같은 기호다.
  it("편집 소식도 저장 소식과 같은 기호로 잘 됐다고 말한다", () => {
    useEditor.setState({ feedbackNotice: { message: msg("save.ok"), tone: "ok" } });
    const withSave = render(<StatusBar />);

    useEditor.setState({ feedbackNotice: null, notice: msg("impact.edges.did", { count: 1 }) });
    const withNotice = render(<StatusBar />);

    expect(markOf(withNotice.container, ".status-bar__mark")).toBe(TONE_MARK.ok);
    expect(markOf(withSave.container, ".status-bar__mark")).toBe(TONE_MARK.ok);
  });

  it.each(["warn", "danger"] as const)(
    "%s 소식은 저장 알림에서나 연결 안내에서나 같은 기호를 단다",
    (tone) => {
      useEditor.setState({ feedbackNotice: { message: msg("save.ok"), tone } });
      const statusBar = render(<StatusBar />);

      useEditor.setState({
        connectionHint: { message: msg("connection.refused"), tone, at: { x: 0, y: 0 } },
      });
      const hint = render(<ConnectionHint />);

      expect(markOf(hint.container, ".connection-hint__mark")).toBe(TONE_MARK[tone]);
      expect(markOf(statusBar.container, ".status-bar__mark")).toBe(TONE_MARK[tone]);
    },
  );
});
