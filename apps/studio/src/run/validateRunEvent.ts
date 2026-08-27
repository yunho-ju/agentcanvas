// 만들어 낸 실행 이벤트가 계약 안에 있는지 committed json_schema/run_event.json으로 확인한다.
import runEventSchema from "../../../../packages/contracts/json_schema/run_event.json";
import { checkerFor } from "../contracts/schemaCheck";

/** 계약 위반을 사람이 읽을 문장으로 돌려준다. 빈 배열이면 통과. */
export const validateRunEvent = checkerFor(runEventSchema);
