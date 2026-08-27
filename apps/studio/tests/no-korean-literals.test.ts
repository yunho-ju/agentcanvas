// 화면 문구는 messages.ts에만 산다 — 컴포넌트와 순수 모듈에 한국어가 남아 있으면
// 그 자리는 언어를 바꿀 수 없는 자리다. 주석은 우리끼리 읽는 글이라 세지 않는다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIR = join(process.cwd(), "src");

/** 문구를 들고 있어도 되는 자리 — 사전 자신과 계약에서 생성된 파일. */
const ALLOWED = ["i18n/messages.ts", "generated/"];

const KOREAN = /[가-힣]/;

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${directory}/${entry.name}`, `${path}/`);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** 주석을 걷어낸 코드 — 남은 한국어는 모두 화면에 나가는 글이다. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("컴포넌트 소스에 남은 한국어", () => {
  const files = sourceFiles(SOURCE_DIR).filter(
    (path) => !ALLOWED.some((allowed) => path.startsWith(allowed)),
  );

  it("사전 바깥에는 한 글자도 없다", () => {
    const leftover = files.filter((path) =>
      KOREAN.test(withoutComments(readFileSync(`${SOURCE_DIR}/${path}`, "utf-8"))),
    );
    expect(leftover).toEqual([]);
  });

  it("검사할 파일을 실제로 찾았다", () => {
    expect(files.length).toBeGreaterThan(30);
  });
});
