// 이 자리를 떠나는 길 — 세션을 여닫는 일은 SessionGate의 것이고, 그 문을 여는 손잡이만
// 문서 메뉴로 내려온다 (DESIGN §7 doc-card 로그아웃). 세션을 모르는 화면에서는 없다(null).
import { createContext, useContext } from "react";

const SignOutContext = createContext<(() => void) | null>(null);

export const SignOutProvider = SignOutContext.Provider;

export function useSignOut(): (() => void) | null {
  return useContext(SignOutContext);
}
