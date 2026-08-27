// 내보내기 전에 committed json_schema/agent_spec.json으로 검증한다.
import agentSpecSchema from "../../../../packages/contracts/json_schema/agent_spec.json";
import { checkerFor } from "../contracts/schemaCheck";

/** 스키마 위반을 사람이 읽을 문장으로 돌려준다. 빈 배열이면 통과. */
export const validateSpec = checkerFor(agentSpecSchema);
