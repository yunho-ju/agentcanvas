// 사람의 답을 서버에 보내는 정책 — 두 번 보내지 않기, 답의 모양 짓기, 실패 처리.
// 사람의 답은 실행에 이벤트를 잇는다 — 한 번의 실행이지 새 실행이 아니다.
// 상태 조회·갱신과 네트워크는 밖에서 주입받는다: 이 자리에는 store도 직접 없다.
import type { RunAnswerOutcome } from "../api/runs";
import type { ApprovalAnswer } from "../generated/approval_answer";
import type { Message } from "../i18n/messages";

/** 멈춰 선 실행에 사람의 답을 보내는 길. */
export type SendRunAnswer = (
  runId: string,
  answer: ApprovalAnswer,
) => Promise<RunAnswerOutcome>;

export interface GateAnswerCallbacks {
  sendRunAnswer: SendRunAnswer;
  /** 흐름이 사람 확인 밸브 앞에 멈춰 서 있는가 */
  isAwaitingGate: () => boolean;
  /** 보내 둔 답의 대답을 기다리는 중인가 */
  isAnswering: () => boolean;
  /** 지금 보고 있는 실행 — 없으면 답할 곳이 없다 */
  activeRunId: () => string | null;
  setAnswering: (answering: boolean) => void;
  onFailure: (message: Message) => void;
  /** 답이 받아들여졌다 — 흐름이 다시 열린다 */
  onAnswered: () => void;
}

/**
 * 사람의 답은 실행에 이벤트를 잇는다 — 한 번의 실행이지 새 실행이 아니다.
 * 승인이면 흐름이 다시 열리고, 거절이면 실행이 그 자리에서 마쳐진다.
 */
export async function answerGate(
  approved: boolean,
  values: Record<string, unknown> | undefined,
  callbacks: GateAnswerCallbacks,
): Promise<void> {
  if (!callbacks.isAwaitingGate()) return;
  // 보내 둔 답의 대답을 기다리는 중이면 두 번 보내지 않는다 (연타도, 마음을 바꾼 답도).
  if (callbacks.isAnswering()) return;
  const runId = callbacks.activeRunId();
  if (runId === null) return;
  callbacks.setAnswering(true);
  const outcome = await callbacks.sendRunAnswer(runId, {
    approved,
    // 적어 넣은 것이 없으면 빈 자리를 남기지 않는다 — 답에 없던 말을 지어내지 않는다.
    ...(values ? { values } : {}),
  });
  callbacks.setAnswering(false);
  // 서버가 답을 받지 못했으면 카드를 닫지 않는다 — 답하지 않은 것과 같은 자리에 그대로 둔다.
  if (outcome.failure) return callbacks.onFailure(outcome.failure);
  callbacks.onAnswered();
}
