// skill 본문(마크다운)을 읽기용 덩어리로 펼치는 순수 함수 (DESIGN §7 skills-panel [읽기]).
// 우리가 다루는 것은 제목·문단·목록·인용 넷뿐이다 — 편집기가 아니라 읽는 자리이므로
// 바깥 마크다운 라이브러리를 들이지 않는다. 읽지 못한 줄도 버리지 않고 문단으로 남긴다.

export type ReadableBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** 이어지던 문단을 닫는다 — 모은 줄이 없으면 아무것도 남기지 않는다. */
function flushed(lines: string[], blocks: ReadableBlock[]): void {
  if (lines.length === 0) return;
  blocks.push({ kind: "paragraph", text: lines.join(" ") });
  lines.length = 0;
}

/** 이어지던 목록을 닫는다. */
function flushedList(
  items: string[],
  ordered: boolean,
  blocks: ReadableBlock[],
): void {
  if (items.length === 0) return;
  blocks.push({ kind: "list", ordered, items: [...items] });
  items.length = 0;
}

export function readableBlocks(markdown: string): ReadableBlock[] {
  const blocks: ReadableBlock[] = [];
  const paragraph: string[] = [];
  let items: string[] = [];
  let ordered = false;

  const closeAll = () => {
    flushed(paragraph, blocks);
    flushedList(items, ordered, blocks);
    items = [];
  };

  for (const line of markdown.split("\n")) {
    const text = line.trim();
    if (text === "") {
      closeAll();
      continue;
    }

    const heading = HEADING.exec(text);
    if (heading) {
      closeAll();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const quoted = QUOTE.exec(text);
    if (quoted) {
      closeAll();
      blocks.push({ kind: "quote", text: quoted[1].trim() });
      continue;
    }

    const bullet = BULLET.exec(text);
    const numbered = NUMBERED.exec(text);
    if (bullet || numbered) {
      const nowOrdered = numbered !== null;
      // 번호의 유무가 달라지면 다른 목록이다.
      if (items.length > 0 && nowOrdered !== ordered) flushedList(items, ordered, blocks);
      flushed(paragraph, blocks);
      ordered = nowOrdered;
      items.push(((bullet ?? numbered) as RegExpExecArray)[1].trim());
      continue;
    }

    flushedList(items, ordered, blocks);
    paragraph.push(text);
  }
  closeAll();
  return blocks;
}
