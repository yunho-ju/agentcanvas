# 거절된 도구가 또 다른 pause로 이어지는 실행 (API_TOOLS P3b 회귀 가드)

`agent_spec.json`은 `ask_first` 도구(charge)의 **error 포트가 사람 확인 밸브(gate)로**
이어지고, 그 밸브의 승인이 다시 done으로 가는 다중-pause 그래프다. 도구의 result
포트는 answer로 간다.

`run_events.rejected_then_gate.json`은 두 번 멈췄다 이어 달린 실행을 못 박는다:
1. charge를 **거절** → error 포트로 gate에 닿아 다시 멈춘다.
2. gate를 **승인** → done이 흐른다.

핵심 회귀 가드: 거절된 도구의 **result 갈래(answer)는 2차 재개에서도 흐르지 않는다.**
한때 `_answers_from`이 도구의 `node.completed{approved:false}`를 밸브 answer로 오인하고,
도구의 나간 포트가 재개 시 복원되지 않아 result·error 두 포트가 모두 흘러 answer가 허위로
실행됐다. 도구의 결말은 포트로(gate는 answer로) 갈라 복원한다 — 두 벌로 겹쳐 쓰지 않는다.
파일은 대조 기준이므로 손으로 고쳐 쓰지 않는다.
