// 화면의 밝기 — 처음에는 시스템을 따르고, 누르면 사용자의 선택이 그보다 먼저가 된다.
// 색은 토큰이 알아서 바꾼다 (tokens.css). 여기가 하는 일은 어느 쪽을 고를지 적어 두는 것뿐이다.
import { useEffect, useState } from "react";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";

export type Theme = "light" | "dark";

/** 시스템이 지금 어느 쪽을 원하는지. matchMedia가 없는 곳(테스트 환경)에서는 밝은 화면이다. */
export function systemTheme(): Theme {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 색만으로 알리지 않는다 — 기호와 글이 지금 무엇을 하게 되는지 함께 말한다. */
const NEXT_THEME: Record<Theme, { theme: Theme; label: MessageKey; mark: string }> = {
  light: { theme: "dark", label: "theme.toDark", mark: "☾" },
  dark: { theme: "light", label: "theme.toLight", mark: "☀" },
};

export function ThemeToggle() {
  // 고르지 않았으면 null이다 — 화면에 아무것도 적지 않아야 시스템이 바뀔 때 따라간다.
  const [chosen, setChosen] = useState<Theme | null>(null);
  const next = NEXT_THEME[chosen ?? systemTheme()];
  const t = useT();

  useEffect(() => {
    if (chosen === null) return;
    document.documentElement.dataset.theme = chosen;
  }, [chosen]);

  return (
    <button
      type="button"
      className="icon-button"
      aria-label={t(next.label)}
      title={t(next.label)}
      onClick={() => setChosen(next.theme)}
    >
      <span aria-hidden="true">{next.mark}</span>
    </button>
  );
}
