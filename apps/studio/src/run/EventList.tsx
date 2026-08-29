// 실행 중에 무슨 일이 있었는지 시간 순서로 읽는 자리.
// 쉬운 말이 본문이고 계약의 event_type 원문은 옆에 붙는 보조 표기다.
import { memo } from "react";
import type { RunEvent } from "../generated/run_event";
import { type Translate, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { currentSeq } from "../store/runSlice";
import { eventSummary, payloadLines } from "./eventWords";

/**
 * 사건 한 줄. 재생 위치가 한 칸 움직일 때 목록 전체를 다시 그릴 이유는 없다 —
 * 자기 사건과 "지금 보고 있는가"가 그대로면 그 줄은 그대로다.
 */
const EventRow = memo(function EventRow({
  event,
  run,
  shown,
  onPick,
  t,
}: {
  event: RunEvent;
  /** 이 실행 전부 — 끝맺음 한 줄이 그 실행에서 일어난 일까지 보고 말한다 */
  run: RunEvent[];
  shown: boolean;
  onPick: (seq: number) => void;
  t: Translate;
}) {
  return (
    <li className="event-list__row">
      <button
        type="button"
        className="event-list__what"
        aria-current={shown}
        onClick={() => onPick(event.seq)}
      >
        <span className="event-list__summary">{t(eventSummary(event, run))}</span>
        <span className="event-list__type">{event.event_type}</span>
      </button>
      {/* 지금 보고 있는 사건만 무엇을 들고 왔는지 펼친다 — 목록이 읽히지 않으면 소용이 없다. */}
      {shown ? (
        <dl className="event-list__payload">
          {payloadLines(event).map((line) => (
            <dd key={line}>{line}</dd>
          ))}
        </dl>
      ) : null}
    </li>
  );
});

export function EventList() {
  const events = useEditor((state) => state.runEvents);
  const seq = useEditor(currentSeq);
  const goToEvent = useEditor((state) => state.goToEvent);
  const t = useT();

  if (events.length === 0) return null;

  return (
    <section className="event-list layer" aria-label={t("eventList.label")}>
      <ol className="event-list__items">
        {events.map((event) => (
          <EventRow
            key={event.seq}
            event={event}
            run={events}
            shown={event.seq === seq}
            onPick={goToEvent}
            t={t}
          />
        ))}
      </ol>
    </section>
  );
}
