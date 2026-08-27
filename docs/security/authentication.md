# Built-in Authentication

This document defines the supported authentication contract for the current AgentCanvas self-hosted profile.

## Deployment profile

AgentCanvas supports one trusted administrator and one implicit workspace. Docker Compose forces `AGENTCANVAS_AUTH_MODE=required`. The internal disabled mode exists for tests and fixtures and is not a supported deployment option.

This is not an account system. It does not provide users, signup, roles, tenant isolation, OIDC, MFA, recovery or a per-user audit trail.

## Fail-closed startup

The API refuses to start when required settings are absent or malformed.

| Variable | Contract |
|---|---|
| `AGENTCANVAS_ADMIN_PASSWORD` | at least 12 characters |
| `AGENTCANVAS_SESSION_SECRET` | at least 32 UTF-8 bytes and separate from the password |
| `AGENTCANVAS_SESSION_TTL_SECONDS` | integer from 60 through 604800; default 28800 |
| `AGENTCANVAS_COOKIE_SECURE` | explicit true/false value |
| `AGENTCANVAS_AUTH_MODE` | `required` for supported deployments |

Rotating the administrator password changes future login validation but does not invalidate already issued stateless sessions. Rotate `AGENTCANVAS_SESSION_SECRET` to invalidate all sessions.

## Public and protected endpoints

Only these HTTP requests are public:

- `GET /health/live`
- `GET /health/ready`
- `POST /auth/login`
- CORS preflight `OPTIONS`

Every other current and future HTTP route is default-deny, including `/auth/session`, `/auth/logout`, OpenAPI and all business APIs. Non-HTTP ASGI traffic is outside this middleware contract.

## Login and session

A successful login returns a generic authenticated response and sets `agentcanvas_session`. The cookie contains a signed, stateless version-1 payload with:

- fixed subject `admin`
- issued-at and expiry timestamps
- a random CSRF nonce

The payload is authenticated with HMAC-SHA256 derived from `AGENTCANVAS_SESSION_SECRET`. The session has a fixed expiry and no sliding refresh. The default TTL is 8 hours and the maximum is 7 days.

Invalid credentials and invalid/expired sessions return a generic 401 response. Authentication responses and middleware errors use `Cache-Control: no-store`.

## Cookie contract

The session cookie is:

- host-only; no `Domain` attribute
- `Path=/`
- `HttpOnly`
- `SameSite=Strict`
- `Max-Age` equal to the configured TTL
- `Secure` when `AGENTCANVAS_COOKIE_SECURE=true`

Compose defaults to loopback HTTP and therefore `Secure=false`. Any HTTPS deployment must terminate TLS at a validated proxy boundary and set `AGENTCANVAS_COOKIE_SECURE=true`. AgentCanvas does not provide built-in TLS or trusted-proxy configuration.

## CSRF

Every authenticated `POST`, `PUT`, `PATCH` and `DELETE`, including logout, requires `X-CSRF-Token`. The value must match the nonce in the authenticated session.

The Studio:

- stores the nonce in memory only
- sends requests with `credentials: include`
- attaches the header to unsafe methods
- does not mount the editor until session validation succeeds
- returns to the login surface after a 401

A missing or mismatched token returns a generic 403 response.

## CORS

Credentialed CORS accepts exact configured origins only. `AGENTCANVAS_ALLOWED_ORIGINS` is comma-separated and `*` is rejected at startup. Compose defaults to `http://localhost:8080`.

When exposing another hostname or port, configure the exact browser origin and keep it consistent with the TLS/cookie boundary.

## Logout and revocation

Logout requires CSRF and deletes the browser cookie. There is no server-side session store and no individual-session revocation list. A copied valid cookie remains valid until expiry unless the session secret is rotated.

## Secret handling

Administrator, session and provider secrets are environment-only. They must not be placed in:

- source control or `.env.example`
- Docker image layers or browser bundles
- AgentSpecs, evaluation datasets or run metadata
- logs, screenshots, issues or support bundles

Use separate secrets for administrator login and session signing. Restrict `.env` permissions and rotate any value that may have been disclosed.

## Explicit non-guarantees

The built-in profile does not provide:

- password hashing/database or multiple accounts
- MFA, OIDC, SSO or account recovery
- role/workspace/tenant authorization
- login rate limiting, throttling or account lockout, in memory or persistent
- per-user security audit logs
- individual session listing/revocation
- managed TLS, WAF or trusted proxy validation

`POST /auth/login` therefore accepts unlimited attempts, so online password guessing is bounded only by the administrator password strength. Any deployment reachable from the internet should enforce request rate limiting and repeated-failure blocking for `/auth/login` at the reverse proxy in front of AgentCanvas.

Do not expose this profile as a public multi-user service. Security reports follow [`../../SECURITY.md`](../../SECURITY.md).
