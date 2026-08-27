// 선택된 연결의 설정. 용어에는 반드시 쉬운 설명이 붙는다.
import type { EdgeKind } from "../generated/agent_spec";
import type { FlowEdge } from "../graph/serialize";
import { type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";

const EDGE_KINDS: { kind: EdgeKind; label: MessageKey }[] = [
  { kind: "data", label: "edge.kind.data" },
  { kind: "control", label: "edge.kind.control" },
  { kind: "approval", label: "edge.kind.approval" },
];

const KIND_HINT = msg("edge.kind.hint");
const CONDITION_HINT = msg("edge.condition.hint");

export function EdgeInspector({ edge }: { edge: FlowEdge }) {
  const updateEdgeKind = useEditor((state) => state.updateEdgeKind);
  const updateEdgeCondition = useEditor((state) => state.updateEdgeCondition);
  const t = useT();

  return (
    <>
      <h2 className="inspector__title">{t("edge.title")}</h2>
      <p className="inspector__id">
        {edge.source}.{edge.sourceHandle} → {edge.target}.{edge.targetHandle}
      </p>

      <div className="inspector__field">
        <label className="inspector__label" htmlFor="edge-kind" title={t(KIND_HINT)}>
          {t("edge.kind.label")}
        </label>
        <select
          id="edge-kind"
          className="control"
          aria-describedby="edge-kind-hint"
          value={edge.data.kind}
          onChange={(event) => updateEdgeKind(edge.id, event.target.value as EdgeKind)}
        >
          {EDGE_KINDS.map(({ kind, label }) => (
            <option key={kind} value={kind}>
              {t(label)}
            </option>
          ))}
        </select>
        <p className="inspector__hint" id="edge-kind-hint">
          {t(KIND_HINT)}
        </p>
      </div>

      <div className="inspector__field">
        <label
          className="inspector__label"
          htmlFor="edge-condition"
          title={t(CONDITION_HINT)}
        >
          {t("edge.condition.label")}
        </label>
        <input
          id="edge-condition"
          className="control"
          type="text"
          aria-describedby="edge-condition-hint"
          value={edge.data.condition?.expression ?? ""}
          onChange={(event) => updateEdgeCondition(edge.id, event.target.value)}
        />
        <p className="inspector__hint" id="edge-condition-hint">
          {t(CONDITION_HINT)}
        </p>
      </div>
    </>
  );
}
