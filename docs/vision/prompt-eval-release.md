# Prompt, Evaluation and Release Vision

> **Vision document; not a capability statement for `v0.1.0-alpha.1`.** Prompt Studio, LLM judges, safety gates, online evaluation, release promotion/deployment and rollback are not implemented.

## Available now / proposed

| Area | Available now | Proposed |
|---|---|---|
| prompt | `prompt_ref` in graph contracts | versioned block editor, diff and labels |
| evaluation | deterministic normalized `expected_phrases` | trace, schema, quality, groundedness and safety evaluators |
| repetition | `runs_per_case` and `passes_needed` | confidence intervals, flaky-case analysis and statistical gates |
| comparison | batch history/detail and two-batch comparison | baseline deltas and Model Matrix |
| release | `ReleaseManifest` data/schema contract | storage, review, promotion, deployment and rollback |
| provider evidence | run events and limited Architect evidence | complete redacted model/tool/context snapshots |

Current evaluation proves only that every configured phrase appears in normalized output for enough attempts. It does not prove task success, quality, safety, groundedness or production fitness.

## Versioned composition goal

A future release should bind immutable references to:

- AgentSpec revision
- prompt revisions
- model/provider snapshot
- tool/MCP policy snapshot
- evaluation suite and evaluator versions
- approval identity, reason and time

The runtime should execute that composition rather than a moving `latest` value. The existing ReleaseManifest schema is only a starting contract.

## Prompt Studio proposal

Prompt content may be modeled as versioned blocks such as system policy, task instruction, context slots, tool instructions and output schema. Proposed UI capabilities include:

- revision history and side-by-side diff
- variable/input preview
- model/tool/context configuration visibility
- smoke dataset execution
- candidate/baseline comparison
- explicit environment labels and rollback

Prompt lifecycle and AgentSpec lifecycle are separate axes that a release composition joins.

## Evaluation layers

A mature evaluation system should combine, where appropriate:

1. deterministic contract checks
2. execution/trace assertions
3. reference-based checks
4. model-based quality judgments with recorded judge version/rationale
5. safety classifiers and adversarial datasets
6. human review for high-impact decisions

Safety and side-effect policy should prefer deterministic enforcement. A model judge score alone must not authorize deployment.

## Repetition and uncertainty

Repeated runs are necessary for stochastic systems. Future reports should distinguish “at least one success” from “consistent success,” show sample size/uncertainty and classify inconclusive changes rather than manufacturing precision. Statistical methods and thresholds must be versioned and documented before they become release gates.

## Guardrail versus evaluation

A guardrail allows or blocks a live action under a latency budget. Evaluation scores stored executions offline. The same detection logic may support both, but enforcement mode, evidence and failure behavior must remain explicit.

## Release review proposal

A review surface may combine:

- graph and prompt diffs
- model/tool/policy changes
- deterministic and statistical evaluation evidence
- critical safety failures
- cost/latency changes
- reviewer identity and rationale

Approval should create an immutable release record. Deployment and rollback require separate adapters and operational acceptance; they are not implied by storing approval.

## Safety boundary

Evaluation fixtures must avoid live secrets and unintended side effects. Tool calls should use read-only fixtures, mocks or isolated sandboxes with network/budget limits. A safety suite detects known regressions; it is not a certification of safety.

## Incremental delivery

1. versioned prompt data and diff
2. deterministic/trace evaluator registry
3. baseline comparison and explicit gate results
4. human review records and ReleaseManifest storage
5. deployment adapters and rollback
6. sampled online evaluation and failure-to-dataset workflow

Every stage must preserve the current alpha's honest evidence boundary.
