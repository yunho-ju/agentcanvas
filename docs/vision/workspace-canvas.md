# Workspace and Live Canvas Vision

> **Vision document; not a capability statement for `v0.1.0-alpha.1`.**

## Available now / proposed

| Area | Available now | Proposed |
|---|---|---|
| entry | blank-canvas Guided or direct editing | template gallery and guided workspace setup |
| graph | node/edge editing, validation, Impact Preview | hot-swap tray and deeper counterfactual preview |
| execution | SSE timeline, history, static comparison | checkpoint fork, synchronized ghost replay |
| evaluation | phrase datasets and batch comparison | Model Matrix and richer quality/safety metrics |
| persistence | one implicit workspace in SQLite | named workspaces, members and server-persisted links |
| sharing | none | invite links, owner/editor/viewer and template fork |
| collaboration | none | presence, soft locks and later CRDT if justified |

## Core loop

The proposed long-term experience is:

```text
connect an explicitly selected model
  → describe the desired agent
  → receive a validated AgentSpec patch preview
  → approve a draft
  → edit and inspect impact on the canvas
  → run and observe normalized events
  → compare evaluation evidence
  → share or release through explicit approval
```

The current alpha reaches the draft/edit/run/phrase-evaluate portions for one administrator. It does not create accounts, collaborative workspaces or deployments.

## Workspace proposal

A future workspace could group:

- AgentSpec revisions
- prompt/model/tool policy snapshots
- evaluation datasets and results
- run/event history
- investigation findings
- release manifests
- members and roles

This is a proposed persistence and authorization model. Current records belong to one implicit workspace, provider secrets are environment-only, and dataset selection in Studio is browser-local—not an ownership or sharing relationship.

## Collaboration sequence

If demand is validated, collaboration should grow incrementally:

1. named workspace and immutable revision history
2. asynchronous sharing with owner/editor/viewer authorization
3. presence and node-level edit indication
4. conflict behavior and optional CRDT only after measured need

Secret values must never follow sharing or template fork. A recipient supplies their own provider configuration.

## Impact Preview direction

Current Impact Preview covers graph-level edit consequences. Future analysis may add:

- affected prompt/context slots
- impacted evaluation cases
- recorded-input smoke replay
- before/after route, output, latency and cost diff

Expensive evaluation must remain explicit rather than running on every drag.

## Live debugging direction

Current Run mode projects stored RunEvents into timeline, node state and static comparison. Proposed extensions include:

- compiled prompt/tool/context inspection with redaction
- checkpoint-based fork replay
- synchronized baseline/candidate playback
- first-divergence navigation
- scalable rendering benchmarks for large graphs

Targets such as 200 nodes or 60fps are engineering goals until a repeatable public benchmark exists.

## Model Matrix direction

A future Model Matrix may run a frozen graph/prompt/tool configuration against multiple explicit model snapshots and compare deterministic and statistical evidence. It must not treat one LLM-judge score as truth, and it must distinguish cloud cost from local-resource cost.

## Accessibility

Future canvas features must preserve keyboard alternatives, reduced motion, non-color state cues and a list/text representation. Collaboration and 3D proposals cannot make the visual canvas the only way to understand or operate the system.
