// skill 본문을 읽기용으로 그리는 자리 — 패널의 [읽기]와 가져오기 카드의 미리보기가 함께 쓴다.
// 무엇이 덩어리인지는 순수 함수(graph/skillMarkdownView)가 정하고, 여기서는 그리기만 한다.
import { type ReadableBlock, readableBlocks } from "../graph/skillMarkdownView";

/** 앞에서 몇 줄만 — 자르지 않을 때는 줄 수를 주지 않는다. */
function firstLines(body: string, lines?: number): string {
  return lines === undefined ? body : body.split("\n").slice(0, lines).join("\n");
}

function Block({ block }: { block: ReadableBlock }) {
  if (block.kind === "heading") {
    // 본문의 제목은 패널·카드의 제목보다 아래 층이다 — h4에서 시작해 더 내려간다.
    const Tag = (block.level <= 2 ? "h4" : "h5") as "h4" | "h5";
    return <Tag className="skill-body__heading">{block.text}</Tag>;
  }
  if (block.kind === "quote") {
    return <blockquote className="skill-body__quote">{block.text}</blockquote>;
  }
  if (block.kind === "list") {
    const items = block.items.map((item) => (
      <li className="skill-body__item" key={item}>
        {item}
      </li>
    ));
    return block.ordered ? (
      <ol className="skill-body__list">{items}</ol>
    ) : (
      <ul className="skill-body__list">{items}</ul>
    );
  }
  return <p className="skill-body__paragraph">{block.text}</p>;
}

export function SkillBody({ body, lines }: { body: string; lines?: number }) {
  return (
    <div className="skill-body">
      {readableBlocks(firstLines(body, lines)).map((block, index) => (
        // 같은 글이 두 번 나올 수 있으므로 자리로 센다 — 이 목록은 순서가 곧 뜻이다.
        <Block block={block} key={`${block.kind}-${index}`} />
      ))}
    </div>
  );
}
