// 브라우저 파일 입출력 — input[type=file]로 열고, Blob 다운로드로 저장한다.
import type { AgentSpec } from "../generated/agent_spec";
import { type Message, msg } from "../i18n/messages";
import { validateSpec } from "./validateSpec";

export type SpecFileResult =
  | { spec: AgentSpec; errors?: undefined }
  | { spec?: undefined; errors: Message[] };

/** 파일 내용을 계약에 맞는 AgentSpec으로 읽는다. 맞지 않으면 이유를 돌려준다. */
export function parseSpec(text: string): SpecFileResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch (error) {
    return { errors: [msg("doc.readFailed", { reason: (error as Error).message })] };
  }
  const errors = validateSpec(candidate).map((problem) =>
    msg("doc.specProblem", { problem }),
  );
  return errors.length > 0 ? { errors } : { spec: candidate as AgentSpec };
}

export function downloadSpec(spec: AgentSpec, filename = "agent_spec.json"): void {
  const blob = new Blob([`${JSON.stringify(spec, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
