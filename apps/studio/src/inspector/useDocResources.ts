// 폼이 고를 것을 문서에서 읽어 오는 하나뿐인 길 — 연결과 도구는 이 문서 안에만 있다.
// 폼 전체에 spec을 흘리지 않기 위해 컨트롤이 직접 store를 읽는다 (선례: useTextDraft).
import type { ResourceBinding } from "../generated/agent_spec";
import { bindingRefs } from "../registry/registry";
import { selectedNode, useEditor } from "../store/editor";

export interface DocResources {
  /** 이 문서가 들고 있는 연결들 */
  bindings: ResourceBinding[];
  /** 지금 고른 노드가 적어 둔 연결 이름 — 아직 아무것도 고르지 않았으면 빈 글자다 */
  ref: string;
  /** 그 이름으로 문서에서 찾은 연결 — 문서에 없는 이름이면 없다 */
  chosen?: ResourceBinding;
}

const NONE: ResourceBinding[] = [];

export function useDocResources(): DocResources {
  const bindings = useEditor((state) => state.spec?.resources) ?? NONE;
  const node = useEditor(selectedNode);
  const nodeType = node?.data.nodeType;
  // 어떤 필드가 연결을 가리키는지는 registry의 마커가 안다 — 여기서 타입 이름을 보지 않는다.
  const refs = node && nodeType ? bindingRefs(node.data.spec, nodeType) : [];
  // 적어 둔 이름이 문서에 없는 것과, 아직 아무것도 안 적은 것은 다른 일이다.
  const ref = refs.find((name) => name.trim() !== "") ?? "";
  return { bindings, ref, chosen: bindings.find((binding) => binding.id === ref) };
}
