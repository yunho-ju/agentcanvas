// 답에 없던 말 — 실패한 케이스의 까닭을 이름으로 말한다 (DESIGN §7 eval-case-card 빠진 말 토막).
// 서버 판정(packages/engine/agentcanvas_engine/evaluation/expected_phrases.py)의 미러다:
// NFC로 맞추고, 대소문자를 지우고, 연속 공백(개행 포함)을 1칸으로 좁힌 뒤 포함 여부를 본다.
// 판정 규칙이 갈라지면 "실패인데 빠진 말이 없다"는 모순 화면이 나오므로, 규칙을 여기서 늘리지 않는다.
//
// 아직 갈라지는 지점(알고 있는 전부):
// - 대소문자: 파이썬 str.casefold는 full case folding이고 JS에는 등가물이 없어 toLowerCase로 맞춘다.
//   독일어 ß(casefold는 "ss"로 접지만 toLowerCase는 그대로 둔다), 그리스어 종결 시그마 ς/Σ에서 갈린다.
// - 공백: JS의 \s는 U+FEFF를 공백으로 보지만 파이썬 re의 \s(str)는 아니다. 그래서 \s를 쓰지 않고
//   파이썬 re의 \s와 같은 글자만 아래에 적는다 — U+FEFF는 빼고, U+001C~001F·U+0085는 넣는다.
// 갈라진 자리는 '어느 말이 빠졌는지 찾지 못했어요' 문구가 받는다 — 모순을 숨기지 않는다.
const WHITESPACE_RUN =
  /[\t\n\v\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

function normalized(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(WHITESPACE_RUN, " ");
}

/** 기대한 말 중 그 회차의 답에 없던 것 — 사람이 적은 그대로 돌려준다. */
export function missingPhrases(outputText: string, expectedPhrases: readonly string[]): string[] {
  const output = normalized(outputText);
  return expectedPhrases.filter((phrase) => !output.includes(normalized(phrase)));
}
