// 모델 피커가 고를 것을 얻는 하나뿐인 길 — 이 서버에게 한 번 묻고, 규칙대로 줄을 세운다.
// 컨트롤이 직접 store를 읽는 것은 useDocResources와 같은 선례다(폼 전체에 상태를 흘리지 않는다).
import { useEffect } from "react";
import { type ModelPicking, modelPicking } from "../registry/modelOptions";
import { useEditor } from "../store/editor";

/** 지금 이 서버에서 고를 것들과 위에 말할 한 줄 — 못 물었으면 번들 목록 그대로다. */
export function useServerModelOptions(): ModelPicking {
  const serverModels = useEditor((state) => state.serverModels);
  const loadServerModels = useEditor((state) => state.loadServerModels);
  // 설정 카드가 서는 것만으로 화면이 서버에게 묻는다 — 사람이 따로 시킬 일이 아니다.
  useEffect(() => {
    void loadServerModels();
  }, [loadServerModels]);
  return modelPicking(serverModels);
}
