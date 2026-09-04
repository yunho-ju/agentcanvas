// 실행 중에 무슨 일이 있었는지 시간 순서로 읽는 자리.
// 쉬운 말이 본문이고 계약의 event_type 원문은 옆에 붙는 보조 표기다.
import { memo } from "react";
import type { RunEvent } from "../generated/run_event";
import { localized } from "../i18n/locale";
import { type Translate, useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { currentSeq } from "../store/runSlice";
import { eventSummary, payloadLines, skillsFollowed } from "./eventWords";
import { runAnswer } from "./runAnswer";
import { groupTurns } from "./turns";
import { type TurnWords, turnWords } from "./turnWords";

/**
 * 사건 한 줄. 재생 위치가 한 칸 움직일 때 목록 전체를 다시 그릴 이유는 없다 —
 * 자기 사건과 "지금 보고 있는가"가 그대로면 그 줄은 그대로다.
 */
const EventRow = memo(function EventRow({
  event,
  run,
  shown,
  inTurn,
  onPick,
  t,
}: {
  event: RunEvent;
  /** 이 실행 전부 — 끝맺음 한 줄이 그 실행에서 일어난 일까지 보고 말한다 */
  run: RunEvent[];
  shown: boolean;
  /** 시도 묶음에 든 줄인가 — 머리말 아래로 들여쓴다 */
  inTurn: boolean;
  onPick: (seq: number) => void;
  t: Translate;
}) {
  const followed = skillsFollowed(event);
  return (
    <li className={inTurn ? "event-list__row event-list__row--in-turn" : "event-list__row"}>
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
          {/* 그 걸음이 무엇을 따랐는지는 원문 이름표보다 먼저, 사람의 말로 읽힌다. */}
          {followed ? <dd>{t(followed)}</dd> : null}
          {payloadLines(event).map((line) => (
            <dd key={line}>{line}</dd>
          ))}
        </dl>
      ) : null}
    </li>
  );
});

/**
 * 시도 묶음의 머리말 — 줄이 아니라 제목이다: 누를 수 없고 aria-current를 갖지 않는다.
 * caption은 머리말이 말하지 않은 것(도구의 쉬운 설명·원문 이름)을 계약의 말로 잇는다.
 */
function TurnHead({ words }: { words: TurnWords }) {
  const locale = useLocale();
  const t = useT();
  const caption = words.caption
    .map((one) => (typeof one === "string" ? one : localized(one, locale)))
    .join(" · ");
  return (
    <li className="event-list__turn">
      <p className="event-list__turn-head">{t(words.heading)}</p>
      {caption === "" ? null : <span className="event-list__turn-tool">{caption}</span>}
    </li>
  );
}

export function EventList() {
  const events = useEditor((state) => state.runEvents);
  const seq = useEditor(currentSeq);
  const goToEvent = useEditor((state) => state.goToEvent);
  // 답은 이 실행이 실제로 돈 판으로만 읽는다 — 지금 화면의 그래프는 이 실행이 돌지 않았다.
  const ranSpec = useEditor(
    (state) => state.runHistory.find((record) => record.id === state.activeRunId)?.specSnapshot,
  );
  const t = useT();

  if (events.length === 0) return null;

  const answer = ranSpec === undefined ? null : runAnswer(ranSpec, events);

  return (
    <section className="event-list layer" aria-label={t("eventList.label")}>
      {answer === null ? null : (
        <div className="event-list__answer">
          <p className="event-list__answer-label">{t("chat.said.answer")}</p>
          <p className="chat-bubble chat-bubble--answer">{answer}</p>
        </div>
      )}
      <ol className="event-list__items">
        {groupTurns(events).flatMap((part) => {
          const words = ranSpec === undefined ? null : turnWords(part, ranSpec);
          return [
            ...(words === null ? [] : [<TurnHead key={`turn-${part.events[0].seq}`} words={words} />]),
            ...part.events.map((event) => (
              <EventRow
                key={event.seq}
                event={event}
                run={events}
                shown={event.seq === seq}
                inTurn={part.turn !== null}
                onPick={goToEvent}
                t={t}
              />
            )),
          ];
        })}
      </ol>
    </section>
  );
}
