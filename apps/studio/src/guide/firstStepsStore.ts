// 첫 걸음 안내를 이미 접었는가 — 그래프의 상태가 아니라 이 브라우저의 기억이다.
// 부수효과(localStorage)는 이 모듈에만 있다 (i18n/localeStore와 같은 방식).

const STORAGE_KEY = "agentcanvas.firstSteps";
const DONE = "done";

/** 전에 이 안내를 접어 두었는가. 기억이 없거나 읽을 수 없으면 접지 않은 것으로 본다. */
export function readFirstStepsDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === DONE;
  } catch {
    // 저장소를 막아 둔 브라우저에서도 화면은 떠야 한다.
    return false;
  }
}

/** 이 안내를 다시 꺼내지 않는다고 적어 둔다 — 숨기기와 완주가 같은 기억을 남긴다. */
export function rememberFirstStepsDismissed(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, DONE);
  } catch {
    // 기억해 두지 못해도 이번 화면에서는 접힌 채로 간다.
  }
}
