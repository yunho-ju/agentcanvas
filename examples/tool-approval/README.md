# 도구를 부르기 전에 사람이 멈춰 세우는 실행 (API_TOOLS P3b)

`agent_spec.json`은 `tool-run` 예제와 같은 그래프지만, 연결의 승인 정책이
`"ask_first"`다 — 도구를 부르기 **전에** 사람의 확인을 기다린다. 되돌릴 수 없는
부수효과(주문·삭제·결제) 앞에 사람을 세우는 자리다.

두 골든은 같은 그래프가 사람의 답에 따라 어떻게 갈라지는지 못 박는다:

- `run_events.approved.json` — 사람이 허락하면 `run.resumed` 뒤에 그때 도구가
  **정확히 한 번** 불리고(`tool.requested` → `tool.completed`), 결과가 result
  포트로 흐른다.
- `run_events.rejected.json` — 사람이 멈추면 도구를 부르지 않는다(`tool.requested`
  없음 — 부르지 않은 것을 적지 않는다). "사람이 멈췄어요"가 error 포트로 흘러
  다음 노드가 그 사실을 받는다.

두 갈래 모두 멈춤·재개는 사람 확인 밸브(`control.human_gate`)와 **같은 hold
메커니즘**을 쓴다 — 새 멈춤 장치를 만들지 않는다. 파일은 대조 기준이므로 손으로
고쳐 쓰지 않는다(실행기가 바뀌면 다시 만들어 diff를 본다).
