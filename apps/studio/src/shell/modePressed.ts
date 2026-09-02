// 지금 눌려 있는 모드는 하나다 (DESIGN §7 mode-segment) — 화면에 보이는 그 모드다.
// 다섯 버튼이 각자 제 사정으로 눌린 척하면 둘이 동시에 눌린다(F15). 판정은 여기서만 난다.

export type Mode = "build" | "run" | "eval" | "optimize" | "chat";

/** 모드 패널이 열려 있으면 그 패널, 아니면 실행 중이면 실행, 아니면 만들기. */
export function pressedMode(open: {
  running: boolean;
  evalOpen: boolean;
  optimizeOpen: boolean;
  chatOpen: boolean;
}): Mode {
  if (open.evalOpen) return "eval";
  if (open.optimizeOpen) return "optimize";
  if (open.chatOpen) return "chat";
  return open.running ? "run" : "build";
}
