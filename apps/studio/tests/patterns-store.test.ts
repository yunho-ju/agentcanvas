// 화면이 서버에게 "이 서버가 놓아 줄 수 있는 모양"을 묻고 담아 두는 자리 — 들은 뒤에는
// 다시 묻지 않고, 못 들었으면 다음 기회에 다시 묻는다 (models-store.test.ts와 같은 규칙).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PatternChoice } from "../src/registry/patternCatalog";
import { useEditor } from "../src/store/editor";

const answered: PatternChoice[] = [
  {
    id: "react",
    shortName: { ko: "도구를 쓰며 답 다듬기", en: "Look things up while answering" },
  },
];

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.setState({ serverPatterns: null });
});

describe("what shapes this server can put on a document", () => {
  it("keeps what the server said", async () => {
    useEditor.setState({ fetchServerPatterns: async () => answered });

    await store().loadServerPatterns();

    expect(store().serverPatterns).toEqual(answered);
  });

  it("keeps knowing nothing when the server cannot be asked", async () => {
    useEditor.setState({ fetchServerPatterns: async () => null });

    await store().loadServerPatterns();

    expect(store().serverPatterns).toBeNull();
  });

  it("does not ask again once it has been told", async () => {
    const fetchServerPatterns = vi.fn(async () => answered);
    useEditor.setState({ fetchServerPatterns });

    await store().loadServerPatterns();
    await store().loadServerPatterns();

    expect(fetchServerPatterns).toHaveBeenCalledTimes(1);
  });

  // 한 번의 실패로 이 화면이 영영 칩 없이 남지 않는다 — 다음 기회에 다시 묻는다.
  it("asks again next time when it could not be told", async () => {
    const fetchServerPatterns = vi.fn(async () => null);
    useEditor.setState({ fetchServerPatterns });

    await store().loadServerPatterns();
    await store().loadServerPatterns();

    expect(fetchServerPatterns).toHaveBeenCalledTimes(2);
  });

  it("asks once while an answer is still on its way", async () => {
    const fetchServerPatterns = vi.fn(async () => answered);
    useEditor.setState({ fetchServerPatterns });

    await Promise.all([store().loadServerPatterns(), store().loadServerPatterns()]);

    expect(fetchServerPatterns).toHaveBeenCalledTimes(1);
  });
});
