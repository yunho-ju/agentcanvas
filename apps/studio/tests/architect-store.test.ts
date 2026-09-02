import { beforeEach, describe, expect, it } from "vitest";
import { makeArchitectSpec } from "../src/architect/architect";
import { useEditor } from "../src/store/editor";
import { providerDraftFixture } from "./architect-fixtures";

beforeEach(() => useEditor.setState({ spec: null, nodes: [], edges: [], architectMode: "guided", architectRequest: "", architectDraft: null, architectReview: null, architectError: null, architectLoading: false, requestArchitectDraft: providerDraftFixture }));

describe("ArchitectSlice", () => {
  it("keeps canvas empty before approval and applies only after approval", async () => {
    const store = useEditor.getState();
    store.setArchitectRequest("make a helpful answer");
    await store.buildArchitectDraft();
    expect(useEditor.getState().spec).toBeNull();
    expect(useEditor.getState().nodes).toHaveLength(0);
    expect(store.applyArchitectDraft()).toBe(true);
    expect(useEditor.getState().nodes).toHaveLength(4);
  });

  it("rejects a blank request without creating a draft", () => {
    useEditor.getState().buildArchitectDraft();

    expect(useEditor.getState().architectDraft).toBeNull();
    expect(useEditor.getState().architectMode).toBe("guided");
    expect(useEditor.getState().architectError).toEqual({ key: "architect.error.empty" });
  });

  it("keeps the blank canvas when the provider refuses", async () => {
    useEditor.setState({
      requestArchitectDraft: async () => ({ failure: { key: "architect.error.offline" } }),
    });
    useEditor.getState().setArchitectRequest("make a helpful answer");

    await useEditor.getState().buildArchitectDraft();

    expect(useEditor.getState().architectDraft).toBeNull();
    expect(useEditor.getState().architectMode).toBe("guided");
    expect(useEditor.getState().nodes).toHaveLength(0);
    expect(useEditor.getState().architectError).toEqual({ key: "architect.error.offline" });
    expect(useEditor.getState().architectLoading).toBe(false);
  });

  it("refuses to overwrite an existing canvas", () => {
    const store = useEditor.getState();
    useEditor.setState({ architectDraft: makeArchitectSpec("request", "draft-fixed"), architectReview: { passed: true, schema: { passed: true, count: 0 }, graph: { passed: true, count: 0 }, dryRun: { passed: true, count: 1 }, toFill: 0 }, nodes: [{ id: "existing" }] as never[] });
    expect(store.applyArchitectDraft()).toBe(false);
    expect(useEditor.getState().nodes).toHaveLength(1);
  });

  it("closes Guided when an existing document is opened", () => {
    useEditor.getState().loadSpec(makeArchitectSpec("opened", "opened-fixed"));

    expect(useEditor.getState().architectMode).toBe("closed");
  });

  it("skips to the existing first-steps card", () => {
    useEditor.getState().skipArchitect();
    expect(useEditor.getState().architectMode).toBe("closed");
    expect(useEditor.getState().architectDraft).toBeNull();
  });
});
