// 캔버스 위의 노드 카드 — 상태를 말하는 자리다. 값은 inspector가 말한다 (디자인 언어 §1.5).
// 상시 보이는 것: 타입 칩 · 이름 · 뱃지. 설명과 포트 이름은 툴팁·hover·선택·연결 중에 나타난다.
import { useEffect, useMemo } from "react";
import { Handle, Position, useConnection, useUpdateNodeInternals } from "@xyflow/react";
import type { PortSpec } from "../generated/node_type";
import { checkConnection } from "../graph/connection";
import { type SetupIssue, nodeSetupIssues } from "../graph/nodeSetupIssues";
import type { AgentNodeData } from "../graph/serialize";
import { localized } from "../i18n/locale";
import { type Translate, useLocale, useT } from "../i18n/useT";
import { useFocusInspector } from "../inspector/inspectorFocus";
import { GateCard } from "../run/GateCard";
import { elapsedWords, STATUS_WORDS } from "../run/statusWords";
import { useEditor } from "../store/editor";
import { NodeTypeChip } from "./NodeTypeChip";
import { type PortAddress, type PortLinkState, portLinkState } from "./portLink";

/** 손볼 곳이 여럿이면 한 줄로 이어 붙인다 — 카드는 한 줄만 내어 준다. */
function issueWords(issues: SetupIssue[], t: Translate): string {
  return issues.map((issue) => t(issue.message)).join(" · ");
}

interface NodeCardProps {
  id: string;
  data: AgentNodeData;
}

function PortList({
  ports,
  side,
  linkStateOf,
}: {
  ports: Record<string, PortSpec>;
  side: "inputs" | "outputs";
  linkStateOf: (portId: string, side: "source" | "target") => PortLinkState;
}) {
  const isInput = side === "inputs";
  const locale = useLocale();
  return (
    <ul className={`node-card__ports node-card__ports--${side}`}>
      {Object.values(ports).map((port) => (
        <li
          key={port.id}
          className="node-card__port"
          data-link={linkStateOf(port.id, isInput ? "target" : "source")}
          title={localized(port.plain_description, locale)}
        >
          <Handle
            type={isInput ? "target" : "source"}
            position={isInput ? Position.Left : Position.Right}
            id={port.id}
          />
          <span className="node-card__port-label">{port.id}</span>
        </li>
      ))}
    </ul>
  );
}

export function NodeCard({ id, data }: NodeCardProps) {
  const { nodeType, ports, runStatus, runElapsedMs, runError } = data;
  const select = useEditor((state) => state.select);
  const halting = useEditor((state) => state.breakpoints.includes(id));
  const focusInspector = useFocusInspector();
  const updateNodeInternals = useUpdateNodeInternals();
  const locale = useLocale();
  const t = useT();
  // 연결을 끄는 동안에만 포트가 서로를 알아본다.
  const from = useConnection((connection) =>
    connection.inProgress && connection.fromHandle?.nodeId
      ? {
          nodeId: connection.fromHandle.nodeId,
          portId: connection.fromHandle.id ?? "",
          side: connection.fromHandle.type,
        }
      : null,
  );

  // 카드가 (다시) 붙거나 포트가 달라지면 제 포트 자리를 캔버스에 다시 알린다 — 되돌리기로
  // 돌아온 노드의 연결선이 끝점을 찾아야 하고, 입력 노드에 행을 적어 새로 생긴 포트에서 끈
  // 연결도 받아들여져야 한다. 포트 이름이 한 글자 바뀌어도 자리는 낡는다 (크기는 그대로라
  // 캔버스가 스스로 다시 재지 않는다). jsdom은 자리를 재지 못한다 — 실브라우저 실증 몫.
  const portIds = [...Object.keys(ports.inputs), ...Object.keys(ports.outputs)].join("\u0000");
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portIds, updateNodeInternals]);

  const status = runStatus ? STATUS_WORDS[runStatus] : undefined;
  // 실행을 보는 동안에는 상태가 카드의 말이다 — 설정 이야기는 편집으로 돌아왔을 때 한다.
  const issues = runStatus ? [] : nodeSetupIssues(data.spec, nodeType);

  // 이을 수 있는지는 계약이 정한다 (checkConnection) — 끌고 있지 않으면 묻지도 않는다.
  const linkStateOf = useMemo(() => {
    const spec = from ? useEditor.getState().exportSpec() : null;
    return (portId: string, side: "source" | "target"): PortLinkState => {
      const port: PortAddress = { nodeId: id, portId, side };
      return portLinkState(from, port, (source, target) =>
        spec
          ? checkConnection(
              spec,
              { node: source.nodeId, port: source.portId },
              { node: target.nodeId, port: target.portId },
            ).ok
          : false,
      );
    };
  }, [from, id]);

  const tooltipId = `node-tip-${id}`;
  return (
    // 카드 자신이 초점을 받는다 — 설명 툴팁에 마우스 없이도 닿기 위해서다.
    <div className="node-card" tabIndex={0} aria-describedby={tooltipId}>
      {/* 상태는 세 번 말한다: 왼쪽 상태 바, 기호, 글 (색맹 안전 — 디자인 언어 §2.3) */}
      {status ? (
        <span className="node-card__rail" data-status={runStatus} aria-hidden="true" />
      ) : null}
      <div className="node-card__head">
        {/* 손으로 꽂아 둔 멈춤 — 재생이 이 노드 앞에서 선다는 표식이다. */}
        {halting ? (
          <span
            className="node-card__breakpoint"
            role="img"
            aria-label={t("breakpoint.mark")}
            title={t("breakpoint.mark")}
          >
            ❚❚
          </span>
        ) : null}
        <NodeTypeChip type={data.spec.type} />
        <span className="node-card__title">
          {localized(nodeType?.display_name, locale) || data.spec.type}
        </span>
        {issues.length > 0 ? (
          <button
            type="button"
            // nodrag: 뱃지를 누르는 것은 카드를 끄는 것이 아니다 (xyflow 약속).
            className="node-card__setup nodrag"
            onClick={() => {
              select("node", id);
              focusInspector();
            }}
            title={issueWords(issues, t)}
          >
            <span className="node-card__setup-mark" aria-hidden="true">
              !
            </span>
            {t("nodeCard.setup")}
          </button>
        ) : null}
        {status ? (
          <span
            className={`node-card__status node-card__status--${runStatus}`}
            role="status"
          >
            <span className="node-card__mark" aria-hidden="true">
              {status.mark}
            </span>
            <span className="node-card__status-label">{t(status.label)}</span>
            {runElapsedMs !== undefined ? (
              <span className="node-card__elapsed">{elapsedWords(runElapsedMs, locale)}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {runStatus === "failed" && runError ? (
        <p className="node-card__error">{runError}</p>
      ) : null}
      {/* 사람의 확인을 기다리는 노드에는 답하는 자리가 함께 선다. */}
      {runStatus === "waiting" ? <GateCard nodeId={id} /> : null}
      <PortList ports={ports.inputs} side="inputs" linkStateOf={linkStateOf} />
      <PortList ports={ports.outputs} side="outputs" linkStateOf={linkStateOf} />
      {/* 설명은 사라진 것이 아니라 여기로 옮겨 왔다 — hover와 키보드 초점 양쪽에서 열린다. */}
      <span role="tooltip" id={tooltipId} className="node-card__tooltip">
        <span className="node-card__tooltip-name">{id}</span>
        {localized(nodeType?.plain_description, locale)}
        {issues.length > 0 ? (
          <span className="node-card__tooltip-issues">{issueWords(issues, t)}</span>
        ) : null}
      </span>
    </div>
  );
}
