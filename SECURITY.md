# Security Policy

## Supported versions

Security fixes are provided on a best-effort basis for the current development line and the latest published prerelease.

| Version | Security updates |
|---|---|
| `main` | Supported |
| Latest published prerelease | Supported |
| Older prereleases | Not supported |

No commercial SLA or bug bounty is provided.

## Reporting a vulnerability

Do not open a public issue or discussion for vulnerabilities, credential exposure, authentication bypass or data-boundary problems.

Use [GitHub Private Vulnerability Reporting](https://github.com/yunho-ju/agentcanvas/security/advisories/new) when the repository presents the private report form. If the form is unavailable, open a minimal [public issue](https://github.com/yunho-ju/agentcanvas/issues/new) that only requests activation of a private reporting channel; do not include vulnerability details, logs, reproduction steps or secrets in that issue.

A private report should include, when possible:

- affected commit/version and deployment profile
- minimal reproduction or proof of concept
- expected impact and attack prerequisites
- mitigations already tested
- disclosure timing constraints

Do not include live credentials, unnecessary personal data or third-party production data. Use fake values and local fixtures.

## Response expectations

Maintainers aim to acknowledge a report within 7 days and provide an initial assessment within 14 days. Complexity and maintainer availability can change these targets. Coordinate disclosure before publishing details.

## Security scope

High-priority areas include:

- authentication, session, CSRF and CORS bypass
- unauthorized access to specs, runs, evaluations or backups
- provider secret and prompt/result disclosure
- SQLite migration, backup, restore and durable lease fencing
- container privilege, reverse proxy and supply-chain issues

General support and documented alpha limitations belong in [public issues](https://github.com/yunho-ju/agentcanvas/issues) under [`SUPPORT.md`](SUPPORT.md).

## Supported deployment boundary

The current profile is one trusted administrator, one implicit workspace, one API process/worker and one file-backed SQLite database. The exact authentication contract is in [`docs/security/authentication.md`](docs/security/authentication.md); deployment and persistence boundaries are in [`docs/operations/deployment.md`](docs/operations/deployment.md) and [`docs/operations/durability.md`](docs/operations/durability.md).

Current limitations include:

- no users, roles, tenant isolation, OIDC, MFA or account recovery
- no login rate limit or security audit log
- no individual server-side session revocation; session-secret rotation revokes all sessions
- no built-in TLS or trusted-proxy profile
- no horizontal scaling or rolling SQLite migration
- no external-provider exactly-once guarantee

Provider and administrator secrets must remain environment-only. Never place them in images, source files, AgentSpecs, browser storage, logs or issue reports.
