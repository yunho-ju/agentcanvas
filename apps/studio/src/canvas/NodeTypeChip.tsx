// 노드 타입을 색과 그린 기호로 알아보게 하는 칩 (디자인 언어 §2.3).
// 기호는 registry 데이터에서 뽑지 않는다 — 타입 하나에 칩 하나를 여기 표로 적는다.
// 새 타입이 생기면 이 표에 한 줄을 더한다 (registry 계약은 건드리지 않는다).

/** 16 격자 위에 같은 굵기로 그린 선. 도형 하나가 곧 한 타입이다. */
interface Chip {
  /** 칩의 색 이름 — app.css가 이 이름으로 저채도 구분색을 고른다 */
  kind: string;
  /** 그린 도형의 경로들 */
  paths: string[];
}

const CHIPS: Record<string, Chip> = {
  // 밖에서 들어와 그래프로 흘러 들어가는 값
  "core.input": { kind: "input", paths: ["M2 8h7.5", "M7 5l3 3-3 3", "M13 3v10"] },
  // 그래프를 빠져나가는 값
  "core.output": { kind: "output", paths: ["M3 3v10", "M6.5 8H14", "M11 5l3 3-3 3"] },
  // 모델이 도구를 써 가며 답을 만든다 — 네 갈래 반짝임
  "llm.agent": {
    kind: "agent",
    paths: ["M8 2.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"],
  },
  // 갈림길 판단 — 하나가 둘로 갈라진다
  "llm.router": { kind: "router", paths: ["M2 8h4", "M6 8l4-4h4", "M6 8l4 4h4"] },
  // 도구 실행 — 바깥 서버에 꽂는 플러그
  "tool.mcp": {
    kind: "tool",
    paths: ["M6 2.5v3", "M10 2.5v3", "M4 5.5h8v2.5a4 4 0 01-8 0z", "M8 12v1.5"],
  },
  // 사람 확인 — 사람이 한 번 들여다본다
  "control.human_gate": {
    kind: "gate",
    paths: ["M8 3.2a2.2 2.2 0 110 4.4 2.2 2.2 0 010-4.4", "M3.8 13.5a4.2 4.2 0 018.4 0"],
  },
};

/** 표에 없는 타입도 자리를 잃지 않는다 — 이름 없는 점 하나로 선다. */
const UNKNOWN_CHIP: Chip = { kind: "unknown", paths: ["M8 8m-3.5 0a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0"] };

export function NodeTypeChip({ type }: { type: string }) {
  const chip = CHIPS[type] ?? UNKNOWN_CHIP;
  return (
    // 칩은 이름 옆의 그림이다 — 읽는 기계에는 이름만 들린다.
    <span className="node-card__chip" data-chip={chip.kind} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        {chip.paths.map((path) => (
          <path key={path} d={path} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </span>
  );
}
