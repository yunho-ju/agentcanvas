## Summary

Describe the user or operator problem and the observable behavior changed by this pull request.

## Scope

- In scope:
- Explicitly out of scope:

## Risk and compatibility

- API/schema/migration impact:
- Security/privacy/secret impact:
- Provider cost or external side-effect impact:
- Rollback or recovery path:

## Validation

List the exact commands and results you ran. Mark checks that do not apply and explain why.

- [ ] Targeted tests
- [ ] `uv run --frozen ruff check packages`
- [ ] `uv run --frozen ruff format --check packages`
- [ ] `uv run --frozen pytest`
- [ ] `pnpm test`
- [ ] `VITE_API_URL=/api pnpm build`
- [ ] Generated type drift check
- [ ] Docker/Compose validation when deployment behavior changes

## Evidence boundaries

Describe what remains unverified. Fixture or deterministic-provider success must not be presented as real-provider or production evidence.

## Contribution declaration

- [ ] Every commit carries a DCO `Signed-off-by` line.
- [ ] I have the right to submit all included code and assets under their stated licenses.
- [ ] I updated documentation and `THIRD_PARTY_NOTICES.md` when required.
- [ ] I removed secrets, personal data, private prompts, cookies, tokens, databases, and provider payloads.
- [ ] I disclosed material AI assistance and reviewed the resulting code and licenses.
