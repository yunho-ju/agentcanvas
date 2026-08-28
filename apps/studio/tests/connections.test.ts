// 문서가 가진 연결에 대한 순수한 셈 — 화면도 store도 이 답을 함께 쓴다.
import { describe, expect, it } from "vitest";
import {
  bindingChanges,
  newConnections,
  toolDiff,
  withConnection,
  withoutConnection,
} from "../src/graph/connections";
import type { ResourceBinding, ToolDef } from "../src/generated/agent_spec";

function tool(name: string, extra: Partial<ToolDef> = {}): ToolDef {
  return {
    name,
    plain_description: { ko: `${name} 한다.`, en: `Does ${name}.` },
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    timeout_ms: 8000,
    call: { transport: "mcp", remote_name: name },
    ...extra,
  } as unknown as ToolDef;
}

function binding(id: string, tools: ToolDef[] = []): ResourceBinding {
  return {
    id,
    kind: "http.api",
    server_ref: `api://${id}`,
    allowed_tools: [],
    approval_policy: "read_only_auto",
    tools,
  } as unknown as ResourceBinding;
}

describe("새로 들어올 연결", () => {
  it("문서에 없는 것만 새 연결이다", () => {
    const arriving = newConnections([binding("a"), binding("b")], [binding("a")]);

    expect(arriving.map((one) => one.id)).toEqual(["b"]);
  });
});

describe("다시 가져온 연결이 무엇을 바꾸는가", () => {
  it("이름으로 새 도구·빠지는 도구를 가른다", () => {
    const diff = toolDiff([tool("search"), tool("get")], [tool("search"), tool("list")]);

    expect(diff.added.map((one) => one.name)).toEqual(["list"]);
    expect(diff.removed.map((one) => one.name)).toEqual(["get"]);
    expect(diff.changed).toEqual([]);
  });

  it("이름이 같아도 내용이 다르면 바뀐 도구다", () => {
    const diff = toolDiff([tool("search")], [tool("search", { timeout_ms: 12000 })]);

    expect(diff.changed.map((one) => one.name)).toEqual(["search"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("적은 차례가 달라도 같은 도구다 — 바뀌었다고 말하지 않는다", () => {
    const written = tool("search");
    const echoed = {
      call: written.call,
      name: written.name,
      timeout_ms: written.timeout_ms,
      output_schema: written.output_schema,
      input_schema: written.input_schema,
      plain_description: written.plain_description,
    } as unknown as ToolDef;

    expect(toolDiff([written], [echoed]).changed).toEqual([]);
  });

  it("계약이 대신 적어 주는 값을 채워 왔다고 바뀐 도구가 아니다", () => {
    // 손으로 적은 문서는 처리 방법을 비워 두고, 서버는 기본값을 적어 돌려준다.
    const written = tool("search");
    const echoed = { ...written, result_handling: { mode: "full" } } as ToolDef;

    expect(toolDiff([written], [echoed]).changed).toEqual([]);
    expect(toolDiff([echoed], [written]).changed).toEqual([]);
  });

  it("기본값이 아닌 처리 방법으로 바뀌면 바뀐 도구다", () => {
    const written = tool("search");
    const digesting = {
      ...written,
      result_handling: { mode: "sections", section_param: "part" },
    } as ToolDef;

    expect(toolDiff([written], [digesting]).changed.map((one) => one.name)).toEqual([
      "search",
    ]);
  });

  it("도구가 없던 연결에서 다시 가져오면 전부 새 도구다", () => {
    const diff = toolDiff([], [tool("search")]);

    expect(diff.added.map((one) => one.name)).toEqual(["search"]);
    expect(diff.removed).toEqual([]);
  });
});

describe("연결 하나를 빼고 갈아 끼우기", () => {
  it("빼면 그 연결만 빠지고 차례는 그대로다", () => {
    const left = withoutConnection([binding("a"), binding("b"), binding("c")], "b");

    expect(left.map((one) => one.id)).toEqual(["a", "c"]);
  });

  it("갈아 끼우면 그 자리에 새 것이 선다 — 차례가 흔들리지 않는다", () => {
    const swapped = withConnection(
      [binding("a"), binding("b"), binding("c")],
      binding("b", [tool("search")]),
    );

    expect(swapped.map((one) => one.id)).toEqual(["a", "b", "c"]);
    expect(swapped[1].tools).toHaveLength(1);
  });

  it("없는 이름을 갈아 끼우라고 하면 아무것도 바꾸지 않는다", () => {
    const same = [binding("a")];

    expect(withConnection(same, binding("ghost"))).toEqual(same);
  });
});

describe("연결 자체가 무엇을 바꾸는가", () => {
  it("바뀐 칸만 말한다 — 그대로인 칸은 말하지 않는다", () => {
    const before = binding("api");
    const after = {
      ...before,
      kind: "mcp.toolset",
      allowed_tools: ["search"],
    } as ResourceBinding;

    expect(bindingChanges(before, after)).toEqual([
      { field: "kind", before: "http.api", after: "mcp.toolset" },
      { field: "allowed_tools", before: "", after: "search" },
    ]);
  });

  it("그대로인 연결은 바뀐 칸이 없다", () => {
    expect(bindingChanges(binding("api"), binding("api"))).toEqual([]);
  });

  it("적지 않은 칸과 빈 목록은 같은 말이다 — 바뀌었다고 하지 않는다", () => {
    const written = { ...binding("api") } as Record<string, unknown>;
    delete written.allowed_tools;

    expect(bindingChanges(written as unknown as ResourceBinding, binding("api"))).toEqual(
      [],
    );
  });
});
