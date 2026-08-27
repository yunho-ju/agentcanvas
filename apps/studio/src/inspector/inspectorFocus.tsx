// "여기서 고치세요"라고 데려가는 길 — 뱃지와 집계 pill이 설정 패널로 초점을 넘긴다.
// 초점은 DOM의 일이라 store에 두지 않는다. 화면 밖(테스트·단독 렌더)에서는 아무 일도 하지 않는다.
import { createContext, useContext } from "react";

const InspectorFocusContext = createContext<() => void>(() => {});

export const InspectorFocusProvider = InspectorFocusContext.Provider;

export function useFocusInspector(): () => void {
  return useContext(InspectorFocusContext);
}
