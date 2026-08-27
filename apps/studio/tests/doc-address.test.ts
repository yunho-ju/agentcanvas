// 주소는 지금 어느 문서를 보고 있는지 말해 준다 — 주소를 복사해 주면 같은 문서가 열린다.
import { describe, expect, it } from "vitest";
import { docIdIn, searchWithDoc } from "../src/shell/docAddress";

describe("주소에서 문서를 읽는 일", () => {
  it("물음표 뒤에 적힌 문서를 찾아낸다", () => {
    expect(docIdIn("?doc=clinical-assistant")).toBe("clinical-assistant");
  });

  it("아무것도 적혀 있지 않으면 가리키는 문서가 없다", () => {
    expect(docIdIn("")).toBeNull();
    expect(docIdIn("?theme=dark")).toBeNull();
    expect(docIdIn("?doc=")).toBeNull();
  });
});

describe("주소에 문서를 적는 일", () => {
  it("보고 있는 문서를 물음표 뒤에 남긴다", () => {
    expect(searchWithDoc("", "draft-abc12345")).toBe("?doc=draft-abc12345");
  });

  it("이미 적혀 있던 문서는 지금 보는 문서로 바뀐다", () => {
    expect(searchWithDoc("?doc=old", "new")).toBe("?doc=new");
  });

  it("같이 적혀 있던 다른 값은 건드리지 않는다", () => {
    expect(searchWithDoc("?theme=dark", "doc-1")).toBe("?theme=dark&doc=doc-1");
  });

  it("가리키는 문서가 없으면 그 자리를 지운다", () => {
    expect(searchWithDoc("?doc=gone", null)).toBe("");
    expect(searchWithDoc("?theme=dark&doc=gone", null)).toBe("?theme=dark");
  });
});
