# AgentCanvas Design Language

This document records the current Studio design principles. Concrete component interaction contracts are in [`../../DESIGN.md`](../../DESIGN.md); implemented token values are in `apps/studio/src/tokens.css` and take precedence when documentation drifts.

## Product test

> Can a first-time non-developer understand the next action quickly, and can they recover from a mistake without fear?

## Experience principles

### One question at a time

Each surface should ask for one decision. Progressive disclosure keeps required settings visible and advanced settings secondary. Modal surfaces are a last resort; prefer inline resolution near the action.

### Plain language, and no term without an explanation

The product exists so that anyone can build an agent, so language is accessibility.

- **Plain wording is the default for every user-facing string.** A technical term is used only when it is more accurate, and even then a plain explanation is attached to it.
- **A term with no explanation cannot exist in the UI.** Every term the user meets—node types, metric names, status values—carries a `plain_description` (one plain sentence) and an `example` as required registry/catalog fields, and the UI always surfaces them on hover/focus. An empty explanation fails validation: the explanation is part of the contract, not documentation. This is enforced today for the node registry and the evaluator catalog in `packages/contracts`.
- **A new term is learned where it is met**, not on a separate documentation page. Example: hovering “Faithfulness ⓘ” explains “Was the answer grounded in the actual source, or made up?”
- **Guided surfaces lead with the plain name and keep the technical name secondary** (for example, “Did it use the tool correctly (Tool Call Accuracy)”). Advanced surfaces invert that order.
- Community-authored node types and metrics follow the same rule: without a `plain_description` they cannot be published.

### Immediate, explicit feedback

Every interaction should visibly acknowledge input. Disabled controls explain why they are unavailable. Success is quiet, progress is observable, and failure is clear without exposing raw server payloads.

### Safe experimentation

Undo remains visible. Potentially destructive graph edits use Impact Preview or a reversible path. Error copy explains the consequence and next action rather than using alarmist language.

### Honest information hierarchy

- **Always visible:** type, name and status; configuration/error problems never hide behind hover.
- **Contextual:** tooltip on hover/focus, compatible port labels during connection, execution summary while running.
- **On request:** inspector details after selection.
- Cards communicate state; inspectors communicate values.

### Meaningful motion

Motion represents creation, connection, execution or transition. Decorative motion is avoided. All behavior must retain equivalent information under `prefers-reduced-motion`. Frame-rate and large-graph numbers are performance targets, not release guarantees, until benchmarked.

## Visual language

The direction is “a precise workbench with signals in motion.” Neutral canvas surfaces preserve attention for graph state. Flow Cyan is reserved for chrome, primary action, selection and focus; run/success/warning/failure have separate semantic colors.

### Core roles

| Role | Light / dark intent | Use |
|---|---|---|
| accent | Flow Cyan | primary action, focus, selection, active mode |
| canvas/surface | neutral layers | workspace, cards and floating panels |
| running | blue | active execution only |
| success | green | completed state |
| warning | amber | incomplete, unreachable or awaiting confirmation |
| danger | red | failed, disconnected or destructive action |

Status always combines color, symbol and text. Color alone is never the only signal.

### Typography and shape

- Pretendard is bundled; no external font CDN.
- Dense tool typography uses title/body/label/caption tokens and tabular numerals.
- Card/control/chip/pill radii use the token scale.
- Hairline plus low shadow defines elevation; shadow alone does not define a boundary.
- Components must use semantic CSS tokens instead of hard-coded color values.

### Canvas

- Neutral solid background; no decorative dot/grid texture.
- Alignment guides appear only while dragging.
- Node cards keep descriptions and port names out of the always-visible layer.
- Compatible ports reveal labels when the user needs them.
- Floating controls use one visual grammar and avoid fixed admin-dashboard columns.

## Accessibility contract

- Keyboard and pointer paths reach equivalent actions.
- Hover-only information must also appear on focus.
- Focus is visible and restored after transient surfaces close.
- Status uses color + symbol + text.
- Reduced-motion preserves timing needed to read feedback.
- Korean and English strings come through the localization dictionary.

## Review checklist

1. Does the surface use implemented semantic tokens?
2. Are hover, active, focus and disabled states defined where applicable?
3. Does a disabled action explain why?
4. Is motion meaningful and interruptible, with a reduced-motion equivalent?
5. Does it work in light and dark themes?
6. Can a new user identify the next action and recover from a mistake?
7. Does copy avoid raw IDs, JSON, server errors and unsupported claims?

## Current and proposed

The current Studio includes Build, Run, Evaluate, Guided onboarding, Impact Preview, run timeline/history/comparison and dataset/batch surfaces. Account/role collaboration, Release, Investigation, synchronized ghost replay, mobile-specific layout and 3D Runtime World are proposals under [`../vision/`](../vision/), not this design language's capability claims.
