# Product Architecture Vision

> **Vision document; not a capability statement for `v0.1.0-alpha.1`.**

## Current foundation

| Available now | Explicitly not available now |
|---|---|
| AgentSpec and RunEvent contracts | shared workspaces and roles |
| Build/Run/Evaluate Studio | Release workflow and deployment |
| restricted Architect patch preview | Prompt Studio and automatic optimization |
| provider adapters and deterministic fallback | MCP gateway/client and LangGraph adapter |
| SQLite persistence and durable jobs | PostgreSQL, horizontal scaling and distributed workers |
| 2D run timeline/history/comparison | complete provenance, fork replay and 3D Runtime World |

The current implementation is described in [`../AGENTCANVAS_DESIGN.md`](../AGENTCANVAS_DESIGN.md).

## Product direction

AgentCanvas aims to make one versioned execution contract understandable across design, execution, evaluation and operations:

```text
AgentSpec
  → visual design and validation
  → controlled runtime
  → normalized RunEvent evidence
  → evaluation and comparison
  → human approval
  → immutable release composition
```

The central rule is that the visual graph and the executed graph must not diverge. AI-generated changes remain restricted patches that require validation and explicit user approval.

## Proposed control-plane layers

```text
Studio
  ├─ Build
  ├─ Run / Replay
  ├─ Evaluate
  ├─ Investigate
  └─ Release

Control Plane
  ├─ AgentSpec / revision registry
  ├─ Prompt, model, tool and policy snapshots
  ├─ run and event APIs
  ├─ evaluation and approval services
  └─ workspace authorization

Runtime
  ├─ provider adapters
  ├─ optional LangGraph adapter
  ├─ MCP gateway and policy
  ├─ checkpoints / replay providers
  └─ normalized event emission

Storage and Operations
  ├─ PostgreSQL option for scaled deployments
  ├─ append-only evidence storage
  ├─ object storage for large artifacts
  ├─ OpenTelemetry export
  └─ signed release artifacts
```

These components are proposed boundaries, not selected implementation commitments.

## Provenance and replay goal

A future runtime should record enough versioned evidence to explain which graph, prompt, model, tool schema and policy produced a result. “Model-visible means logged” is a goal that requires explicit redaction, storage and privacy design; the current alpha does not guarantee complete prompt/tool/context reconstruction.

Replay should use first-class recorded provider adapters rather than a special UI-only path. External side effects still cannot be made exactly-once without upstream idempotency.

## MCP and human control goal

A future MCP boundary should separate discovery, credentials, permissions, approval and schema snapshots. Browser clients must never receive MCP/provider secrets. Side-effecting tools should be policy-controlled and human approval should be represented in the execution contract.

The current alpha has human graph gates but no real MCP client/executor.

## Decision record: interoperability protocols

Agent-to-agent communication (our agent calling an external agent, or being called by one) is out of the initial scope, but the direction is already fixed so that later work does not re-open it:

- **Tool and data connections follow the official MCP specification.** See “MCP and human control goal” above; the current alpha has no real MCP client/executor.
- **Agent-to-agent alignment is A2A v1.0 (Linux Foundation).**

Why this was chosen: our `ref` grammar already has a place for an `agent://` scheme, and Run/RunEvent can project the A2A Task lifecycle, so alignment can be added as an adapter plus a node type **without changing the contracts**. Choosing the direction now keeps the contract shape stable while deferring the work. The specifications must be re-checked for their latest revision when the work actually starts.

## Storage evolution

SQLite remains appropriate for the current single-node profile. A PostgreSQL transition should be triggered by measured needs such as multiple writers, horizontal workers, larger retention or online migration—not by vision alone. Any transition requires a documented data model, migration path and rollback boundary.

## Rendering direction

2D remains the precise editing and operations surface. A future 3D Runtime World may project the same AgentSpec and RunEvent for structure/traffic exploration, but it must not create a second source of truth or become the only accessible interface.

## Related proposals

- [`workspace-canvas.md`](workspace-canvas.md)
- [`prompt-eval-release.md`](prompt-eval-release.md)
- [`investigation-mode.md`](investigation-mode.md)
