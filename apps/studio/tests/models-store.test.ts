// 화면이 서버에게 "무엇을 부를 수 있나"를 묻고 담아 두는 자리 — 들은 뒤에는 다시 묻지 않고,
// 못 들었으면 다음 기회에 다시 묻는다. 무엇을 어떤 차례로 보여 줄지는 registry의 규칙이다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerCatalog } from "../src/registry/modelOptions";
import { useEditor } from "../src/store/editor";

const answered: ServerCatalog = {
  mode: "live",
  models: [
    {
      ref: "model://openai",
      title: { ko: "OpenAI의 모델 — gpt-x", en: "OpenAI — gpt-x" },
      callable: true,
      reason: null,
    },
  ],
};

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.setState({ serverModels: null });
});

describe("what this server can call", () => {
  it("keeps what the server said", async () => {
    useEditor.setState({ fetchServerModels: async () => answered });

    await store().loadServerModels();

    expect(store().serverModels).toEqual(answered);
  });

  it("keeps knowing nothing when the server cannot be asked", async () => {
    useEditor.setState({ fetchServerModels: async () => null });

    await store().loadServerModels();

    expect(store().serverModels).toBeNull();
  });

  it("does not ask again once it has been told", async () => {
    const fetchServerModels = vi.fn(async () => answered);
    useEditor.setState({ fetchServerModels });

    await store().loadServerModels();
    await store().loadServerModels();

    expect(fetchServerModels).toHaveBeenCalledTimes(1);
  });

  // 한 번의 실패로 이 화면이 영영 번들 목록에 갇히지 않는다 — 다음 기회에 다시 묻는다.
  it("asks again next time when it could not be told", async () => {
    const fetchServerModels = vi.fn(async () => null);
    useEditor.setState({ fetchServerModels });

    await store().loadServerModels();
    await store().loadServerModels();

    expect(fetchServerModels).toHaveBeenCalledTimes(2);
  });

  it("asks once while an answer is still on its way", async () => {
    const fetchServerModels = vi.fn(async () => answered);
    useEditor.setState({ fetchServerModels });

    await Promise.all([store().loadServerModels(), store().loadServerModels()]);

    expect(fetchServerModels).toHaveBeenCalledTimes(1);
  });
});
