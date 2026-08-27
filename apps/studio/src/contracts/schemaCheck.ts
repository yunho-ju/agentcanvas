// committed json_schema로 값을 재는 자를 만든다 — 계약 위반은 사람이 읽을 문장이 된다.
import Ajv from "ajv";
import addFormats from "ajv-formats";

/** 스키마 하나로 검사기를 만든다. 검사기는 위반 문장 목록을 돌려주고, 빈 배열이면 통과다. */
export function checkerFor(schema: object): (candidate: unknown) => string[] {
  // format(date-time 등)은 계약이 정한 제약이다 — 켜 두지 않으면 검사기가 그냥 지나친다.
  const validate = addFormats(new Ajv({ allErrors: true, strict: false })).compile(schema);
  return (candidate) => {
    if (validate(candidate)) return [];
    return (validate.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`,
    );
  };
}
