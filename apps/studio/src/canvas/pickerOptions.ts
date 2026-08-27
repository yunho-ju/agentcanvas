// 포트에서 빈 캔버스로 끌어다 놓았을 때 뜨는 피커의 목록 (브리프 B4·B5).
// 이을 수 있는지는 계약이 정한다 — 여기에는 새 판정 규칙이 없고, checkConnection에게 물을 뿐이다.
import type { AgentSpec, Node1 as SpecNode } from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import { checkConnection } from "../graph/connection";
import { uniqueId } from "../graph/ids";
import type { Locale } from "../i18n/locale";
import { localized } from "../i18n/locale";
import { nodeTypes, resolvePorts } from "../registry/registry";
import type { PortAddress } from "./portLink";

export interface PickerOption {
  /** registry의 노드 종류 */
  type: string;
  /** 고르는 순간 이어질 새 노드의 포트 — 연결 없이 열었다면 없다 */
  port?: string;
}

export interface PickerQuery {
  spec: AgentSpec;
  /** 끌고 온 포트 — 없으면 빈 캔버스에서 그냥 연 것이다 */
  from: PortAddress | null;
  query: string;
  locale: Locale;
  registry?: Record<string, NodeType>;
}

/** 아직 놓지 않은 노드 — 이을 수 있는지 물어보기 위해서만 잠깐 존재한다. */
function candidateNode(spec: AgentSpec, type: string): SpecNode {
  return {
    id: uniqueId(
      "candidate",
      spec.nodes.map((node) => node.id),
    ),
    type,
    position: { x: 0, y: 0 },
    config: {},
  };
}

/** 끌고 온 포트에 이 종류를 이을 수 있다면, 이어질 자리의 이름. */
function linkablePort(
  spec: AgentSpec,
  from: PortAddress,
  nodeType: NodeType,
): string | undefined {
  const candidate = candidateNode(spec, nodeType.type);
  const probe = { ...spec, nodes: [...spec.nodes, candidate] };
  const side = from.side === "source" ? "inputs" : "outputs";
  const held = { node: from.nodeId, port: from.portId };

  return Object.keys(resolvePorts(candidate, nodeType, spec.input_schema)[side]).find(
    (port) => {
      const mine = { node: candidate.id, port };
      const [source, target] = from.side === "source" ? [held, mine] : [mine, held];
      return checkConnection(probe, source, target).ok;
    },
  );
}

/** 사용자가 아는 이름은 하나가 아니다 — 화면에 보이는 이름으로도, 종류 이름으로도 찾는다. */
function matches(nodeType: NodeType, query: string, locale: Locale): boolean {
  const looking = query.trim().toLowerCase();
  if (looking === "") return true;
  return [localized(nodeType.display_name, locale), nodeType.type].some((name) =>
    name.toLowerCase().includes(looking),
  );
}

/** 지금 이 자리에 놓을 수 있는 노드들. 이을 수 없는 종류는 아예 오르지 않는다. */
export function pickerOptions({
  spec,
  from,
  query,
  locale,
  registry = nodeTypes,
}: PickerQuery): PickerOption[] {
  return Object.values(registry).flatMap((nodeType) => {
    if (!matches(nodeType, query, locale)) return [];
    if (!from) return [{ type: nodeType.type }];
    const port = linkablePort(spec, from, nodeType);
    return port === undefined ? [] : [{ type: nodeType.type, port }];
  });
}
