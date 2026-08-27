# Support

AgentCanvas is alpha software and does not provide a commercial support SLA.

## Where to ask

- Reproducible bugs: [open a bug report](https://github.com/yunho-ju/agentcanvas/issues/new?template=bug_report.yml)
- Feature proposals: [open a feature request](https://github.com/yunho-ju/agentcanvas/issues/new?template=feature_request.yml)
- Installation or usage questions: [search existing issues](https://github.com/yunho-ju/agentcanvas/issues) first, then use [GitHub Discussions](https://github.com/yunho-ju/agentcanvas/discussions); blank issues are disabled, so a question that turns out to be a defect belongs in the bug report template
- Vulnerabilities and private conduct reports: follow [`SECURITY.md`](SECURITY.md); do not use a public issue

## Supported profile

- one trusted administrator
- one implicit workspace
- source-built Docker Compose deployment
- Python 3.12, Node.js 22.20, pnpm 10.15.1 and uv 0.8.15 development toolchain
- one API process/worker with one file-backed SQLite database

Not currently supported:

- public multi-user or multi-tenant service
- managed SaaS
- Kubernetes, horizontal scaling or rolling SQLite migration
- built-in TLS/trusted proxy configuration
- external-provider exactly-once semantics
- long-term backports for older alpha versions

Public operator documentation:

- authentication: [`docs/security/authentication.md`](docs/security/authentication.md)
- deployment: [`docs/operations/deployment.md`](docs/operations/deployment.md)
- durability: [`docs/operations/durability.md`](docs/operations/durability.md)
- backup and restore: [`docs/operations/backup-and-restore.md`](docs/operations/backup-and-restore.md)

## Before opening an issue

1. Reproduce on the latest published prerelease or current `main` when practical.
2. Check [`README.md`](README.md), known limitations and [`docs/OPERATIONS_ROADMAP.md`](docs/OPERATIONS_ROADMAP.md).
3. Remove secrets, `.env` contents, real databases, private prompts and personal data.
4. Include version/commit, OS, deployment method, minimal steps and sanitized logs.

Maintainers may classify out-of-scope requests as roadmap or external-contribution candidates and cannot guarantee response or fix dates.
