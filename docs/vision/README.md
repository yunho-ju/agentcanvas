# AgentCanvas Vision

> These documents are proposals, not capability statements for `v0.1.0-alpha.1`.

**Status.** Parts of three proposals have since shipped, so those files now open with their own Status note saying what is real and what is still a proposal: `api-tools.md` (tool wrapping and the HTTP tool adapter), `live-chat-and-analytics.md` (the Talk mode) and `optimize.md` (the Improve mode). `prompt-eval-release.md` is still a proposal, but its judge-model layer shipped as the last rung of the Test mode's evaluation ladder. Everything else here remains unbuilt.

Current behavior is documented in [`../../README.md`](../../README.md), [`../AGENTCANVAS_DESIGN.md`](../AGENTCANVAS_DESIGN.md), [`../security/`](../security/) and [`../operations/`](../operations/).

## Proposals

- [`product-architecture.md`](product-architecture.md): long-term control-plane architecture
- [`workspace-canvas.md`](workspace-canvas.md): workspace, collaboration and richer live-canvas UX
- [`prompt-eval-release.md`](prompt-eval-release.md): prompt lifecycle, advanced evaluation and release gates
- [`investigation-mode.md`](investigation-mode.md): evidence-based incident investigation
- [`api-tools.md`](api-tools.md): wrapping existing HTTP APIs as canvas tools, with AI-assisted generation
- [`live-chat-and-analytics.md`](live-chat-and-analytics.md): publishing an agent, letting people talk to it, and reading those conversations as reasons to change the prompt
- [`optimize.md`](optimize.md): generating candidate spec revisions from run/eval evidence and comparing them on an explicit evidence table before a human picks one

A vision item becomes a supported capability only after its contract, implementation, tests and public operator documentation land in a released snapshot.
