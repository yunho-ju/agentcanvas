// 가짜 서버가 진짜 서버와 같은 말투를 쓰는가 — 같은 파일에 못 박아 둔 모양으로 견준다.
// (pytest의 test_the_answer_the_server_gives_is_the_recorded_shape가 반대편을 지킨다.)
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import savedSpec from "../../../examples/basic-agent/saved_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;
const recorded = savedSpec as unknown as AgentSpec;

describe("가짜 서버의 말투", () => {
  it("진짜 서버가 돌려주는 모양 그대로다", () => {
    expect(asServerAnswer(example)).toEqual(recorded);
  });

  it("빠진 자리를 빠짐없이 채운다 — 조건 없는 연결도 조건 칸을 달고 온다", () => {
    const answer = asServerAnswer(example);

    expect(answer.edges.every((edge) => "condition" in edge)).toBe(true);
    expect(answer.name).toBeNull();
  });

  it("화면이 만든 그래프와는 모양이 다르다 — 그 차이가 이 시험의 이유다", () => {
    expect(JSON.stringify(asServerAnswer(example))).not.toBe(JSON.stringify(example));
  });
});
