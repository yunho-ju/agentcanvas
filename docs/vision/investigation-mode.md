# Investigation Mode Vision

> **Vision document; not a capability statement for `v0.1.0-alpha.1`.** Investigation Agent, Issue Chat, evidence/finding stores, sandbox experiments and 3D investigation overlays are not implemented.

## Current prerequisites

The alpha currently provides:

- stored AgentSpec revisions
- append-only run events and run history
- static comparison of two runs
- evaluation batch history and comparison

It does not guarantee complete prompt/context/tool provenance, release lookup, conversation mapping or causal diagnosis.

## Goal

Investigation Mode would connect a user-reported problem to versioned execution evidence and answer:

1. Which run and configuration produced the result?
2. Where is the first meaningful divergence from a baseline?
3. Is the evidence consistent with graph, prompt, context, tool, policy, model or evaluator failure?
4. What evidence supports and contradicts each hypothesis?
5. What safe experiment could falsify the leading hypothesis?

The system must prefer “unverified” over an unsupported causal claim.

## Proposed result states

- `CONFIRMED`: direct execution and configuration evidence support the finding
- `LIKELY`: strong evidence exists but a falsification step remains
- `UNVERIFIED`: required evidence is missing
- `REJECTED`: collected evidence contradicts the hypothesis

Model confidence alone must never produce `CONFIRMED`.

## Proposed evidence model

A finding would reference immutable locations rather than only free-form text:

- run/event sequence
- graph and node/edge revision
- prompt/context/tool snapshot
- baseline/candidate comparison
- evaluator input/result/version
- evidence and counter-evidence

Sensitive values require redaction and access control before this feature can be enabled in multi-user deployments.

## Read-only agent boundary

The proposed Investigation Agent may read authorized evidence and request sandbox experiments. It must not directly:

- edit production prompts or graph edges
- change tool permissions
- bypass a human gate
- approve or deploy a release
- claim evidence that was not collected

Changes become a separate proposal with explicit review and required evaluation.

## First-divergence analysis

Comparison should align structured events and identify the earliest relevant difference in execution path, state, prompt blocks, context items, tool calls, model snapshot or evaluator input. Text diff alone is insufficient.

A difference is not automatically a cause. The finding must connect it to observed impact and retain counter-evidence.

## Counterfactual sandbox

Proposed experiments include recorded-provider replay, prompt-block toggles, context-mapping overrides and route fixtures. External writes must be mocked or dry-run. Inputs, model/tool snapshots and evaluation criteria must remain fixed when testing one hypothesis.

## Delivery sequence

1. run selection and structured timeline comparison
2. prompt/configuration evidence with redaction
3. typed findings and first-divergence navigation
4. read-only investigation assistant
5. sandbox falsification experiments
6. reviewed change proposals

Each stage requires its own authorization, retention and disclosure analysis.
