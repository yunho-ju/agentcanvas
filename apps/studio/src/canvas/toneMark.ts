// 소식의 세기마다 다른 기호 — 색을 보지 못해도 셋이 구분된다 (DESIGN §9 색+기호+쉬운 말).
// 같은 세기는 화면 어디에서나 같은 기호로 말한다: 표는 여기 한 곳에만 산다.

export const TONE_MARK = { ok: "✓", warn: "!", danger: "✕" } as const;

export type Tone = keyof typeof TONE_MARK;
