// 서버가 흘려보내는 줄글(Server-Sent Events)을 토막으로 끊어 읽는 일 — 입력에서 출력만 나오는 순수 함수다.
// 청크는 아무 자리에서나 끊겨 도착한다: 끊긴 꼬리는 돌려주고, 다음 청크와 이어 붙여 다시 읽는다.
// 토막에 실린 것이 무엇인지는 여기서 따지지 않는다 (이벤트로 읽는 일은 api/runs가 한다).
// 서버가 붙인 이름표(`id:`)는 읽지 않는다 — 순번은 몸통에 실린 이벤트가 스스로 말한다.
// 전제: 우리 서버는 토막을 `\n\n`으로만 끊는다 (run_stream.py) — 그래서 CRLF는 다루지 않는다.

/** 읽어 낸 토막들(각각의 몸통)과, 아직 끝나지 않아 다음 청크를 기다리는 꼬리. */
export interface SseRead {
  frames: string[];
  rest: string;
}

/** 토막이 끝나는 자리 — 빈 줄 하나가 "여기까지"라는 뜻이다. */
const FRAME_END = "\n\n";

/** 이름과 값을 가르는 자리. `:`로 시작하는 줄은 이름이 없는 줄, 곧 사람에게 하는 주석이다. */
function fieldOf(line: string): { name: string; value: string } | null {
  const at = line.indexOf(":");
  if (at <= 0) return null;
  const value = line.slice(at + 1);
  return { name: line.slice(0, at), value: value.startsWith(" ") ? value.slice(1) : value };
}

/** 토막 하나의 몸통 — 여러 줄로 왔으면 줄바꿈으로 이어 하나로 읽는다. 몸통이 없으면 토막이 아니다. */
function bodyOf(block: string): string | null {
  const data = block
    .split("\n")
    .map(fieldOf)
    .filter((field) => field?.name === "data")
    .map((field) => field?.value ?? "");
  return data.length === 0 ? null : data.join("\n");
}

/** 읽던 꼬리에 새 청크를 이어 붙여, 끝난 토막들과 새 꼬리로 가른다. */
export function readSse(rest: string, chunk: string): SseRead {
  const blocks = `${rest}${chunk}`.split(FRAME_END);
  const frames = blocks
    .slice(0, -1)
    .map(bodyOf)
    .filter((frame): frame is string => frame !== null);
  return { frames, rest: blocks.at(-1) ?? "" };
}
