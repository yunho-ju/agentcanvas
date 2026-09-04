// 이 서버가 놓아 줄 수 있는 모양 — 상태 전이만 한다. 서버 답을 읽는 일은
// registry/patternCatalog.ts의 것이고, 묻는 일은 api/patterns.ts의 것이다
// (modelsSlice와 같은 문법).
import type { StateCreator } from "zustand";
import { fetchServerPatternsFromServer } from "../api/patterns";
import { type CannotPutReason, cannotPut, resolveAnchors } from "../graph/patternAnchors";
import { placeNewNodes } from "../graph/patternPlacement";
import { putTemplate } from "../graph/patternPut";
import { settingsChanged } from "../graph/patternWords";
import { sceneOf } from "../graph/scene";
import { putPattern } from "../history/graphCommands";
import { type MessageKey, msg } from "../i18n/messages";
import { type PatternChoice, thisScreenCanDraw } from "../registry/patternCatalog";
import { CANVAS_ORIGIN } from "./graphSlice";
import { selectedNode } from "./editor";
import type { EditorState } from "./editor";

/** 못 놓는 까닭마다 사람이 읽는 한 줄 — 이름은 계약의 사유와 하나다. */
const CANNOT_WORDS: Record<CannotPutReason, MessageKey> = {
  ambiguous_anchor: "pattern.cannot.ambiguous",
  missing_node: "pattern.cannot.missing",
  needs_tools: "pattern.cannot.needsTools",
  no_tools_anywhere: "pattern.cannot.noToolsAnywhere",
  unknown_port: "pattern.cannot.unknownPort",
};

export interface PatternsSlice {
  /** 이 서버가 말한 모양들. null은 아직·끝내 모른다는 뜻이다(모르면 칩을 세우지 않는다) */
  serverPatterns: PatternChoice[] | null;
  fetchServerPatterns: typeof fetchServerPatternsFromServer;
  loadServerPatterns: () => Promise<void>;
  /**
   * 이 모양을 지금 문서에 놓는다 — 카드도 선도 한 걸음이다 (설계 문서 D12).
   * 놓을 수 없으면 조용히 지나가지 않는다: 왜 못 놓는지 그 자리에서 말한다.
   * 놓았는지를 돌려준다 — 초점을 옮기는 일은 DOM의 것이라 화면이 이 답을 보고 정한다.
   */
  putPattern: (patternId: string) => boolean;
}

export const createPatternsSlice: StateCreator<EditorState, [], [], PatternsSlice> = (
  set,
  get,
) => {
  // 지금 길 위에 있는 물음 — 여러 자리가 동시에 물어도 서버에 가는 것은 하나다.
  let asking: Promise<void> | null = null;

  return {
    serverPatterns: null,
    fetchServerPatterns: (options) => fetchServerPatternsFromServer(options),
    loadServerPatterns: async () => {
      // 들은 것이 있으면 다시 묻지 않는다. 못 들은 것은 다음 기회에 다시 묻는다.
      if (get().serverPatterns !== null) return;
      if (asking !== null) return asking;
      asking = (async () => {
        const said = await get().fetchServerPatterns();
        if (said !== null) set({ serverPatterns: said });
      })().finally(() => {
        asking = null;
      });
      return asking;
    },

    putPattern: (patternId) => {
      const shape = get().serverPatterns?.find((pattern) => pattern.id === patternId);
      // 목록은 이미 그릴 수 있는 줄만 세우지만, 이 문으로 들어오는 손님이 팔레트뿐은 아니다.
      if (!shape || !thisScreenCanDraw(shape)) return false;
      // 팔레트에는 손이 있던 캔버스 위의 점이 없다 — 말은 캔버스가 시작하는 자리에 선다.
      const refuse = (reason: CannotPutReason) => {
        get().showConnectionHint({
          message: msg(CANNOT_WORDS[reason]),
          tone: "warn",
          at: CANVAS_ORIGIN,
        });
        return false;
      };

      get().ensureDoc();
      const scene = sceneOf(get());
      const anchors = resolveAnchors(
        shape.template,
        { nodes: scene.nodes.map((node) => node.data.spec), resources: scene.resources },
        selectedNode(get())?.id ?? null,
      );
      if (cannotPut(anchors)) return refuse(anchors.cannot);

      const put = putTemplate(
        scene,
        shape.template,
        anchors,
        placeNewNodes(shape.template, anchors, {
          nodes: scene.nodes,
          viewport: get().viewportBox,
        }),
      );
      if (cannotPut(put)) return refuse(put.cannot);

      get().runCommand(putPattern(scene, put));
      // 이 모양이 손댄 단계로 데려간다 — 새 카드가 있으면 그 카드, 없으면 설정이 바뀐 단계다.
      // 그러지 않으면 설정만 바꾸는 모양은 아무 일도 없던 것처럼 보인다 (DESIGN §7 palette).
      const fresh = put.nodes.find(
        (node) => !scene.nodes.some((standing) => standing.id === node.id),
      );
      const touched = fresh?.id ?? settingsChanged(scene, put)?.id;
      if (touched) {
        get().select("node", touched);
        // 놓았는데 화면 밖이면 놓은 줄도 모른다 (DESIGN §7 palette 배치).
        get().revealNode(touched);
      }
      // 놓였다는 사실이 이미 답이다 — 앞의 말은 그 자리에서 물러난다.
      get().clearConnectionHint();
      return true;
    },
  };
};
