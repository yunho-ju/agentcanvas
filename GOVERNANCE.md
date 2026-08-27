# Governance

AgentCanvas is a maintainer-led open-source alpha project. This document defines the minimum decision process while the maintainer group is small.

## Roles

### Project lead

The current project lead is [`@yunho-ju`](https://github.com/yunho-ju). The project lead approves product direction, release scope, trademark and license changes, and maintainer appointments.

### Maintainers

Maintainers triage issues, review changes, enforce release gates and moderate community spaces. A maintainer must recuse from conduct or security decisions involving a conflict of interest.

### Contributors

Anyone submitting issues, reviews, documentation or code under the Apache-2.0 and DCO terms is a contributor. A contribution does not automatically grant merge or release access.

## Decision process

1. Small bug fixes and documentation changes use maintainer review.
2. API/schema/migration, security, dependency, product-scope and operations-contract changes start with a public issue or design proposal.
3. Proposals should describe the problem, alternatives, compatibility/data impact and validation plan.
4. Evidence and consensus are preferred. When consensus is not possible, the project lead decides against the documented public scope and records the rationale.

Private security reports follow [`SECURITY.md`](SECURITY.md) and are not discussed publicly before coordinated disclosure.

## Maintainer eligibility

A contributor may be nominated after sustained high-quality contributions, respectful review/community participation and demonstrated care for security, licensing and data boundaries. The project lead defines the granted scope. Access may be removed after prolonged inactivity or for security reasons.

## Releases

- Every release points to an immutable commit and changelog entry.
- Required CI must pass on the release commit.
- Alpha or fixture evidence is not represented as production or real-provider evidence.
- Security disclosure timing is coordinated with reporters.
- License changes do not retroactively remove rights already granted for existing contributions.
- Tags, artifacts and release notes are created only by maintainers with release access.

## Review ownership

`@yunho-ju` is the initial review owner. Branch protection and `CODEOWNERS`, when enabled, must reference actual maintainers only; placeholder users or teams are not used.

## Amendments

Governance changes are proposed by pull request and must explain authority changes and contributor impact. Project-lead approval is required.
