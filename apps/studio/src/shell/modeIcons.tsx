// 모드 다섯 개의 그림 (DESIGN §7 mode-segment 아이콘 전용).
// 문자 글리프는 획이 가늘어 무엇인지 읽히지 않는다 — 뜻이 보편적인 형태를 같은 굵기로 그린다.
// 이름은 버튼의 aria-label과 title이 말한다: 이 그림은 읽어 주지 않는다.
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="mode-segment__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 만들기 — 연필 */
export const BuildIcon = () => (
  <Icon>
    <path d="M4 20.5l4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16.5l-1.2 4z" />
    <path d="M14.8 5.2l3 3" />
  </Icon>
);

/** 실행 — 재생 삼각형 */
export const RunIcon = () => (
  <Icon>
    <path d="M7.5 4.8l11 7.2-11 7.2z" />
  </Icon>
);

/** 시험 — 체크 있는 클립보드 */
export const EvalIcon = () => (
  <Icon>
    <path d="M9 4.5H7.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2H15" />
    <path d="M9 3h6v3H9z" />
    <path d="M9 13.5l2.2 2.2 4-4.4" />
  </Icon>
);

/** 고치기 — 스파클(제안을 받아 더 낫게 만드는 일) */
export const OptimizeIcon = () => (
  <Icon>
    <path d="M11 3.5l1.9 4.6 4.6 1.9-4.6 1.9L11 16.5l-1.9-4.6L4.5 10l4.6-1.9z" />
    <path d="M17.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
);

/** 대화 — 말풍선 */
export const ChatIcon = () => (
  <Icon>
    <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H9l-4.5 2.5 1.3-4A7.5 7.5 0 0 1 13 4h.2a7.5 7.5 0 0 1 7.3 7.5z" />
  </Icon>
);
