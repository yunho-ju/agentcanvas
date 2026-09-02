// 상단 레이어가 접히는 폭 (DESIGN §1 상단 레이어). 폭은 여기에만 적는다 —
// app.css의 @media도 이 문자열을 그대로 쓰고, 어긋나면 layout-css 테스트가 잡는다.
import { useEffect, useState } from "react";

/** 이 폭 아래에서는 모드 세그먼트가 이름 대신 아이콘만 보여 준다. */
export const MODE_ICONS_ONLY = "(max-width: 1100px)";
/** 이 폭 아래에서는 되돌리기·다시하기가 문서 메뉴로 들어간다. */
export const HISTORY_IN_MENU = "(max-width: 900px)";
/** 이 폭에서는 편집을 권하지 않는다 — 보기만 된다고 말한다 (§10 모바일 범위 밖). */
export const READ_ONLY_WIDTH = "(max-width: 599px)";

/** 지금 이 폭 조건이 맞는가. matchMedia가 없는 곳(테스트·구형)에서는 늘 넓은 화면으로 본다. */
export function useWidthMatch(query: string): boolean {
  const [matched, setMatched] = useState(() => nowMatches(query));

  useEffect(() => {
    const width = globalThis.matchMedia?.(query);
    if (!width) return;
    setMatched(width.matches);
    const onChange = () => setMatched(width.matches);
    width.addEventListener("change", onChange);
    return () => width.removeEventListener("change", onChange);
  }, [query]);

  return matched;
}

function nowMatches(query: string): boolean {
  return globalThis.matchMedia?.(query).matches ?? false;
}
