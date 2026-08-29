// 게시 상태 — 지금 이 문서가 어느 판을 대화 상대로 내놓았는가. 게시는 저장된 판을 가리키는
// 가벼운 행위라 저장 축과 따로 산다(저장된 최신 판 ≠ 게시된 판일 수 있다). 서버가 판을
// 고정하므로 화면은 그 결과만 안다: 게시된 revision과, 그 판이 몇 번째였는지.
import type { StateCreator } from "zustand";
import {
  type PublicationOutcome,
  type PublishOutcome,
  type UnpublishOutcome,
  fetchPublication,
  publishSpec,
  unpublishSpec,
} from "../api/publish";
import type { SpecPublication } from "../generated/spec_publication";
import type { EditorState } from "./editor";
import { unsavedChanges } from "./saveSlice";

/** 저장된 판을 서버에 게시하는 길. 시험은 이 자리에 가짜를 꽂는다. */
export type SendPublish = (id: string, revision: string) => Promise<PublishOutcome>;
export type SendUnpublish = (id: string) => Promise<UnpublishOutcome>;
export type AskPublication = (id: string) => Promise<PublicationOutcome>;

export interface PublishSlice {
  /** 지금 이 문서가 내놓은 판 — 게시한 적이 없으면 없다 */
  publication: SpecPublication | null;
  /** 게시된 판이 몇 번째 판이었는가 — 표식이 'N번째 판'을 말할 때 쓴다 */
  publishedVersion: number | null;
  sendPublish: SendPublish;
  sendUnpublish: SendUnpublish;
  askPublication: AskPublication;
  /** 지금 저장된 판을 대화 상대로 내놓는다 (저장 안 된 변경이 있으면 내놓지 않는다) */
  publishCurrent: () => Promise<void>;
  /** 게시를 내린다 */
  unpublishCurrent: () => Promise<void>;
  /** 문서를 열 때 그 문서가 이미 내놓은 판이 있는지 불러온다 */
  loadPublication: (id: string) => Promise<void>;
}

/** 게시된 판이 몇 번째였는지 — 지금 저장본과 같으면 그 번호, 다르면 판 기록에서 찾는다. */
async function versionOf(
  state: EditorState,
  publication: SpecPublication,
): Promise<number | null> {
  if (state.savedSpec?.revision === publication.revision) {
    return state.savedSpec.version;
  }
  const outcome = await state.fetchRevisions(publication.spec_id);
  const match = outcome.revisions?.find(
    (revision) => revision.revision === publication.revision,
  );
  return match?.version ?? null;
}

export const createPublishSlice: StateCreator<EditorState, [], [], PublishSlice> = (
  set,
  get,
) => ({
  publication: null,
  publishedVersion: null,
  sendPublish: (id, revision) => publishSpec(id, revision),
  sendUnpublish: (id) => unpublishSpec(id),
  askPublication: (id) => fetchPublication(id),

  publishCurrent: async () => {
    const saved = get().savedSpec;
    // 게시는 저장된 판을 가리킨다 — 없는 판이나 저장 안 된 변경을 내놓지 않는다.
    if (get().spec === null || saved === null) {
      set({ feedbackNotice: { message: { key: "publish.blocked.none" }, tone: "warn" } });
      return;
    }
    if (unsavedChanges(get())) {
      set({
        feedbackNotice: { message: { key: "publish.blocked.unsaved" }, tone: "warn" },
      });
      return;
    }
    const outcome = await get().sendPublish(saved.id, saved.revision);
    if (outcome.failure) {
      set({ feedbackNotice: { message: outcome.failure, tone: "danger" } });
      return;
    }
    set({
      publication: outcome.publication,
      publishedVersion: saved.version,
      feedbackNotice: { message: { key: "publish.ok" }, tone: "ok" },
    });
  },

  unpublishCurrent: async () => {
    const id = get().savedSpec?.id ?? get().spec?.id;
    if (id === undefined) return;
    const outcome = await get().sendUnpublish(id);
    if (outcome.failure) {
      set({ feedbackNotice: { message: outcome.failure, tone: "danger" } });
      return;
    }
    set({
      publication: null,
      publishedVersion: null,
      feedbackNotice: { message: { key: "publish.down.ok" }, tone: "ok" },
    });
  },

  loadPublication: async (id) => {
    const outcome = await get().askPublication(id);
    // 불러오기는 사람이 시킨 일이 아니라 문서를 여는 곁일 뿐 — 못 닿아도 조용히 둔다(토스트 없음).
    if (outcome.failure) return;
    if (outcome.publication === null) {
      set({ publication: null, publishedVersion: null });
      return;
    }
    const version = await versionOf(get(), outcome.publication);
    set({ publication: outcome.publication, publishedVersion: version });
  },
});
