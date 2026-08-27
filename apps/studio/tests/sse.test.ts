// 서버가 흘려보내는 줄글을 토막으로 끊어 읽는 일 — 순수 함수라 네트워크 없이 시험한다.
// 이름표(`id:`)는 읽지 않는다 — 순번은 몸통의 이벤트가 스스로 말하고, 이 파서는 몸통만 건넨다.
// 청크는 아무 자리에서나 끊겨 도착하므로, 끊긴 자리를 이어 붙이는 것이 이 파서의 일이다.
import { describe, expect, it } from "vitest";
import { readSse } from "../src/api/sse";

describe("흘러오는 줄글을 토막으로 끊어 읽는 일", () => {
  it("몸통이 실린 한 토막을 읽는다", () => {
    const read = readSse("", 'id: 3\ndata: {"seq":3}\n\n');

    expect(read.frames).toEqual(['{"seq":3}']);
    expect(read.rest).toBe("");
  });

  it("한 청크에 여러 토막이 실려 와도 순서대로 읽는다", () => {
    const read = readSse("", "id: 1\ndata: one\n\nid: 2\ndata: two\n\n");

    expect(read.frames).toEqual(["one", "two"]);
  });

  it("아직 끝나지 않은 토막은 다음 청크를 기다린다", () => {
    const read = readSse("", "id: 7\ndata: half");

    expect(read.frames).toEqual([]);
    expect(read.rest).toBe("id: 7\ndata: half");
  });

  it("아무 자리에서 끊긴 토막도 이어 붙여 읽는다", () => {
    const first = readSse("", 'id: 7\nda');
    const second = readSse(first.rest, 'ta: {"seq":7}\n\n');

    expect(second.frames).toEqual(['{"seq":7}']);
    expect(second.rest).toBe("");
  });

  it("서버가 조용하다고 보내는 한 마디는 토막이 아니다", () => {
    const read = readSse("", ": keepalive\n\nid: 1\ndata: one\n\n");

    expect(read.frames).toEqual(["one"]);
  });

  it("이름표를 달지 않은 토막도 토막이다", () => {
    const read = readSse("", "data: only\n\n");

    expect(read.frames).toEqual(["only"]);
  });

  it("몸통이 여러 줄이면 줄바꿈으로 이어 하나로 읽는다", () => {
    const read = readSse("", "data: first\ndata: second\n\n");

    expect(read.frames).toEqual(["first\nsecond"]);
  });

  it("몸통 없는 토막은 아무것도 말하지 않은 것이다", () => {
    const read = readSse("", "id: 9\n\ndata: one\n\n");

    expect(read.frames).toEqual(["one"]);
  });

  it("빈 청크는 읽던 자리를 그대로 둔다", () => {
    const read = readSse("id: 1\n", "");

    expect(read.frames).toEqual([]);
    expect(read.rest).toBe("id: 1\n");
  });
});
