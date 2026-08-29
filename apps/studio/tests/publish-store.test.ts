// 게시 흐름 — 저장된 판을 대화 상대로 내놓고, 캔버스를 고쳐도 그 판이 고정되며, 내리면 사라진다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { PublicationOutcome, PublishOutcome, UnpublishOutcome } from "../src/api/publish";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SpecPublication } from "../src/generated/spec_publication";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function publicationOf(spec: AgentSpec): SpecPublication {
  return {
    spec_id: spec.id,
    revision: spec.revision,
    published_at: "2026-08-29T09:00:00+00:00",
  };
}

function asSaved(): AgentSpec {
  // 서버가 매긴 그대로의 저장본 — 지금 캔버스와 같은 내용이라 저장 안 된 변경이 없다.
  return store().exportSpec();
}

beforeEach(() => {
  store().loadSpec(example);
  const saved = asSaved();
  useEditor.setState({
    savedSpec: saved,
    publication: null,
    publishedVersion: null,
    feedbackNotice: null,
    sendPublish: async (): Promise<PublishOutcome> => ({
      publication: publicationOf(saved),
    }),
    sendUnpublish: async (): Promise<UnpublishOutcome> => ({ ok: true }),
    askPublication: async (): Promise<PublicationOutcome> => ({ publication: null }),
  });
});

describe("PublishSlice", () => {
  it("has no publication before a graph is published", () => {
    expect(store().publication).toBeNull();
  });

  it("publishes the saved revision and remembers which version went out", async () => {
    await store().publishCurrent();

    expect(store().publication?.revision).toBe(store().savedSpec?.revision);
    expect(store().publishedVersion).toBe(store().savedSpec?.version);
    expect(store().feedbackNotice?.tone).toBe("ok");
  });

  it("refuses to publish while there are unsaved changes", async () => {
    store().renameSpec("Changed on the canvas");

    await store().publishCurrent();

    expect(store().publication).toBeNull();
    expect(store().feedbackNotice?.tone).toBe("warn");
  });

  it("keeps the published pointer put when the canvas moves on", async () => {
    await store().publishCurrent();
    const publishedRevision = store().publication?.revision;
    const publishedVersion = store().publishedVersion;

    // 게시 뒤 저장본이 새 판으로 넘어가도(만드는 쪽이 캔버스를 고쳐 저장) 게시는 그 판 그대로.
    useEditor.setState({
      savedSpec: { ...(store().savedSpec as AgentSpec), version: 9, revision: "sha256:" + "a".repeat(64) },
    });

    expect(store().publication?.revision).toBe(publishedRevision);
    expect(store().publishedVersion).toBe(publishedVersion);
  });

  it("takes the publication down and says so", async () => {
    await store().publishCurrent();

    await store().unpublishCurrent();

    expect(store().publication).toBeNull();
    expect(store().publishedVersion).toBeNull();
    expect(store().feedbackNotice?.tone).toBe("ok");
  });

  it("loads the publication a saved document already had", async () => {
    const saved = store().savedSpec as AgentSpec;
    useEditor.setState({
      askPublication: async (): Promise<PublicationOutcome> => ({
        publication: publicationOf(saved),
      }),
    });

    await store().loadPublication(saved.id);

    expect(store().publication?.revision).toBe(saved.revision);
    expect(store().publishedVersion).toBe(saved.version);
  });

  it("says why it could not reach the server when publishing", async () => {
    useEditor.setState({
      sendPublish: async (): Promise<PublishOutcome> => ({
        failure: { key: "publish.offline" },
      }),
    });

    await store().publishCurrent();

    expect(store().publication).toBeNull();
    expect(store().feedbackNotice?.tone).toBe("danger");
  });
});
