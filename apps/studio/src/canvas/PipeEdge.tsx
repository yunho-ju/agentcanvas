// 실행 중 데이터가 지나는 연결은 관이 된다 — 방울이 흐르는 것은 지금 그 연결로 값이 건너가는 중이라는 뜻이다.
// 어느 연결이 무엇인지는 화면이 정하지 않는다: data.flowState는 RunEvent에서 파생된 사실이다 (run/player).
import { BaseEdge, type Edge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { FlowEdgeData } from "../graph/serialize";

/**
 * 관을 지나는 방울들이 얼마나 앞서 출발하는가 (한 바퀴를 1로 본 간격).
 * 일부러 고르지 않게 벌려 둔다 — 기계적인 등간격은 물이 아니라 톱니처럼 보인다.
 */
const DROP_LEADS = [0, 0.23, 0.49, 0.78];

/** 방울 하나 — 흐르는 길과 출발이 얼마나 앞선지만 알고, 속도와 크기는 CSS가 정한다. */
function dropStyle(path: string, lead: number): CSSProperties {
  return { "--pipe-path": `path("${path}")`, "--pipe-lead": lead } as CSSProperties;
}

export function PipeEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerStart,
  markerEnd,
  interactionWidth,
  style,
  data,
}: EdgeProps<Edge<FlowEdgeData>>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const carrying = data?.flowState === "carrying";
  // 잠긴 밸브 앞에서는 방울이 흐르던 자리에 그대로 선다 — 멈춘 것은 흐름 자체다.
  const dropClass = data?.held
    ? "pipe-edge__drop pipe-edge__drop--held"
    : "pipe-edge__drop";
  const shade = `pipe-shade-${id}`;

  return (
    <>
      {/* 관은 온 쪽이 옅고 가는 쪽이 진하다 — 방울이 없어도 어느 쪽으로 흐르는지 보인다. */}
      {carrying && (
        <linearGradient
          id={shade}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop className="pipe-edge__shade-tail" offset="0%" />
          <stop className="pipe-edge__shade-head" offset="100%" />
        </linearGradient>
      )}
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={carrying ? { ...style, stroke: `url(#${shade})` } : style}
      />
      {carrying &&
        DROP_LEADS.map((lead) => (
          <circle key={lead} className={dropClass} style={dropStyle(path, lead)} />
        ))}
    </>
  );
}

/** 캔버스가 이 관을 부르는 이름 — 실행 표시(runMarks)가 연결에 적는 이름과 같아야 한다. */
export const flowEdgeTypes = { flow: PipeEdge };
