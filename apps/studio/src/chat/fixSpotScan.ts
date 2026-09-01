// 지난 대화들을 훑는 정책 — 무엇을 다시 묻고, 몇씩 묻고, 어느 판으로 판정하는가.
// 서버에 닿는 일은 전부 주입받는다(ports): 이 자리는 순서와 값만 정하고, 상태는 부르는 쪽이 쥔다.
import type { ThreadEventsOutcome, ThreadSummary } from "../api/threads";
import type { AgentSpec } from "../generated/agent_spec";
import { type FixSpot, fixSpotsIn } from "./fixSpots";

/** 한 대화를 훑어 둔 것 — 그때 그 대화가 어떤 모습이었는지(mark)와, 그때 나온 자리들. */
export interface ScannedThread {
  /** 훑을 때 그 대화의 모습 — 이 값이 그대로면 다시 묻지 않는다 (threadMark) */
  mark: string;
  spots: FixSpot[];
}

/**
 * 그 대화가 지금 어떤 모습인가 — 다시 훑어야 할지를 이 한 값으로 가른다.
 * 마지막 시각만 보면 놓치는 것이 있다: **밸브 승인은 새 실행을 열지 않고 하던 실행을 이어 가므로**
 * 마지막 실행이 열린 시각이 그대로다. 그래서 마지막 상태와 오간 횟수까지 함께 본다 —
 * 셋 다 서버가 목록마다 새로 계산해 주는 값이라 이 판정에 추가로 묻는 일은 없다.
 */
export function threadMark(summary: ThreadSummary): string {
  return `${summary.last_at}|${summary.last_status}|${summary.turns}`;
}

export type FixSpotScan = Record<string, ScannedThread>;

export interface ScanPorts {
  readEvents: (threadId: string) => Promise<ThreadEventsOutcome>;
  /** 그 판의 몸통 — 못 받으면 없다(null). 판정을 지어내지 않기 위해 필요하다 */
  readRevision: (revision: string) => Promise<AgentSpec | null>;
  /** 다시 물을 것 없이 그대로 쓰는 것들 — 훑기를 시작하며 한 번에 알린다 */
  keep: (carried: FixSpotScan) => void;
  /** 한 대화를 훑는 대로 곧바로 알린다 — 느린 하나가 끝난 것들을 가리지 않는다 */
  found: (threadId: string, scanned: ScannedThread) => void;
  /** 그 대화는 훑지 못했다 — 조용하다고 말하지 않기 위해 이것도 곧바로 알린다 */
  missed: (threadId: string) => void;
}

/** 한 번에 몇 대화까지 물어볼지 — 목록이 길어도 서버를 한꺼번에 두드리지 않는다. */
export const SCAN_AT_ONCE = 4;

/** 목록에서 그 대화를 지웠으면 훑어 둔 것도 함께 사라진다 — 없는 대화의 자리를 들고 있지 않는다. */
export function withoutThread(scan: FixSpotScan, threadId: string): FixSpotScan {
  return Object.fromEntries(Object.entries(scan).filter(([id]) => id !== threadId));
}

/** 정해진 수만큼만 동시에 일한다 — 앞의 것이 끝나야 다음 것을 집는다. */
async function eachAtOnce<Item>(
  items: Item[],
  atOnce: number,
  work: (item: Item) => Promise<void>,
): Promise<void> {
  let next = 0;
  const hands = Array.from({ length: Math.min(atOnce, items.length) }, async () => {
    while (next < items.length) {
      const mine = items[next];
      next += 1;
      await work(mine);
    }
  });
  await Promise.all(hands);
}

/**
 * 목록의 대화들을 훑어 고칠 자리를 파생한다.
 * - 모습(threadMark)이 그대로인 대화는 다시 묻지 않는다.
 * - **판정은 그 대화가 붙잡은 판으로 한다**: 지금 게시된 판으로 옛 대화를 읽으면 멀쩡한 답이
 *   사라진 것처럼 보인다. 같은 판은 한 번만 받아 온다.
 * - 오간 말이나 판 몸통을 못 받은 대화는 판정하지 않고 못 훑은 것으로 남긴다(지어내지 않는다).
 * 훑은 것은 도착하는 대로 알린다 — 다 끝나기를 기다려 한꺼번에 내놓지 않는다.
 */
export async function scanThreads(
  threads: ThreadSummary[],
  known: FixSpotScan,
  ports: ScanPorts,
  atOnce: number = SCAN_AT_ONCE,
): Promise<void> {
  const carried: FixSpotScan = {};
  const asked = new Map<string, Promise<AgentSpec | null>>();
  const changed: ThreadSummary[] = [];

  for (const summary of threads) {
    const before = known[summary.thread_id];
    if (before && before.mark === threadMark(summary)) carried[summary.thread_id] = before;
    else changed.push(summary);
  }
  // 목록에 없는 대화는 여기서 빠진다 — 지운 대화의 자리를 들고 있지 않는다.
  ports.keep(carried);

  /** 그 판의 몸통 — 같은 판을 함께 기다리던 대화들은 한 번의 물음을 나눠 쓴다. */
  function bodyOf(revision: string): Promise<AgentSpec | null> {
    const already = asked.get(revision);
    if (already) return already;
    const asking = ports.readRevision(revision);
    asked.set(revision, asking);
    return asking;
  }

  await eachAtOnce(changed, atOnce, async (summary) => {
    const heard = await ports.readEvents(summary.thread_id);
    if (heard.turns === undefined) return ports.missed(summary.thread_id);
    const body = await bodyOf(summary.spec_revision);
    if (body === null) return ports.missed(summary.thread_id);
    ports.found(summary.thread_id, {
      mark: threadMark(summary),
      spots: fixSpotsIn(body, summary.last_status, heard.turns),
    });
  });
}
