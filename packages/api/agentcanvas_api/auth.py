"""비용 없는 self-host 관리자 인증 — 비밀번호는 환경에, 세션은 서명된 쿠키에 둔다."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

AUTH_MODE_ENV = "AGENTCANVAS_AUTH_MODE"
ADMIN_PASSWORD_ENV = "AGENTCANVAS_ADMIN_PASSWORD"
SESSION_SECRET_ENV = "AGENTCANVAS_SESSION_SECRET"
SESSION_TTL_ENV = "AGENTCANVAS_SESSION_TTL_SECONDS"
COOKIE_SECURE_ENV = "AGENTCANVAS_COOKIE_SECURE"

SESSION_COOKIE = "agentcanvas_session"
DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60
MIN_PASSWORD_LENGTH = 12
MIN_SESSION_SECRET_BYTES = 32
MAX_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
PUBLIC_REQUESTS = {
    ("GET", "/health/live"),
    ("GET", "/health/ready"),
    ("POST", "/auth/login"),
}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _boolean(name: str, written: str) -> bool:
    normalized = written.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be true or false")


@dataclass(frozen=True)
class AuthSettings:
    """프로세스가 시작할 때 확정되는 단일 관리자 인증 설정."""

    enabled: bool
    admin_password: str = ""
    session_secret: bytes = b""
    session_ttl_seconds: int = DEFAULT_SESSION_TTL_SECONDS
    cookie_secure: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> AuthSettings:
        mode = environ.get(AUTH_MODE_ENV, "required").strip().lower()
        if mode == "disabled":
            return cls.disabled()
        if mode != "required":
            raise RuntimeError(f"{AUTH_MODE_ENV} must be required or disabled")

        password = environ.get(ADMIN_PASSWORD_ENV, "")
        if len(password) < MIN_PASSWORD_LENGTH:
            raise RuntimeError(
                f"{ADMIN_PASSWORD_ENV} must contain at least {MIN_PASSWORD_LENGTH} characters"
            )
        secret = environ.get(SESSION_SECRET_ENV, "").encode()
        if len(secret) < MIN_SESSION_SECRET_BYTES:
            raise RuntimeError(
                f"{SESSION_SECRET_ENV} must contain at least {MIN_SESSION_SECRET_BYTES} bytes"
            )
        try:
            ttl = int(environ.get(SESSION_TTL_ENV, str(DEFAULT_SESSION_TTL_SECONDS)))
        except ValueError as error:
            raise RuntimeError(f"{SESSION_TTL_ENV} must be an integer") from error
        if not 60 <= ttl <= MAX_SESSION_TTL_SECONDS:
            raise RuntimeError(
                f"{SESSION_TTL_ENV} must be between 60 and {MAX_SESSION_TTL_SECONDS}"
            )
        secure = _boolean(COOKIE_SECURE_ENV, environ.get(COOKIE_SECURE_ENV, "false"))
        return cls(
            enabled=True,
            admin_password=password,
            session_secret=secret,
            session_ttl_seconds=ttl,
            cookie_secure=secure,
        )

    @classmethod
    def disabled(cls) -> AuthSettings:
        """테스트·로컬 fixture가 명시적으로 선택하는 무인증 모드."""
        return cls(enabled=False)


@dataclass(frozen=True)
class AdminSession:
    subject: str
    issued_at: int
    expires_at: int
    csrf_token: str


class BuiltinAuth:
    """비밀번호 확인과 HMAC 세션 발급·검증을 한 경계에 둔다."""

    def __init__(
        self,
        settings: AuthSettings,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.settings = settings
        self._clock = clock
        self._session_key = hmac.digest(
            settings.session_secret, b"agentcanvas/session/v1", hashlib.sha256
        )
        self._password_key = hmac.digest(
            settings.session_secret, b"agentcanvas/password/v1", hashlib.sha256
        )

    @property
    def enabled(self) -> bool:
        return self.settings.enabled

    def password_matches(self, candidate: str) -> bool:
        if not self.enabled or len(candidate) > 4096:
            return not self.enabled
        expected = hmac.digest(
            self._password_key,
            self.settings.admin_password.encode(),
            hashlib.sha256,
        )
        provided = hmac.digest(self._password_key, candidate.encode(), hashlib.sha256)
        return hmac.compare_digest(expected, provided)

    def issue(self) -> tuple[str, AdminSession]:
        now = int(self._clock())
        session = AdminSession(
            subject="admin",
            issued_at=now,
            expires_at=now + self.settings.session_ttl_seconds,
            csrf_token=secrets.token_urlsafe(32),
        )
        payload = {
            "v": 1,
            "sub": session.subject,
            "iat": session.issued_at,
            "exp": session.expires_at,
            "csrf": session.csrf_token,
        }
        encoded = _encode(
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        )
        signature = _encode(
            hmac.digest(self._session_key, encoded.encode(), hashlib.sha256)
        )
        return f"{encoded}.{signature}", session

    def verify(self, token: str | None) -> AdminSession | None:
        if not self.enabled:
            now = int(self._clock())
            return AdminSession("admin", now, now + 60, "")
        if token is None or len(token) > 4096:
            return None
        try:
            payload_segment, signature_segment = token.split(".", 1)
            signature = _decode(signature_segment)
            expected = hmac.digest(
                self._session_key, payload_segment.encode(), hashlib.sha256
            )
            if not hmac.compare_digest(expected, signature):
                return None
            payload = json.loads(_decode(payload_segment))
            session = AdminSession(
                subject=payload["sub"],
                issued_at=payload["iat"],
                expires_at=payload["exp"],
                csrf_token=payload["csrf"],
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return None
        now = int(self._clock())
        if (
            session.subject != "admin"
            or not isinstance(session.issued_at, int)
            or not isinstance(session.expires_at, int)
            or not isinstance(session.csrf_token, str)
            or session.issued_at > now + 30
            or session.expires_at <= now
            or session.expires_at - session.issued_at
            > self.settings.session_ttl_seconds
        ):
            return None
        return session

    def cookie_token(self, scope: Scope) -> str | None:
        written = _header(scope, b"cookie")
        if written is None:
            return None
        try:
            cookies = SimpleCookie()
            cookies.load(written)
            morsel = cookies.get(SESSION_COOKIE)
            return morsel.value if morsel is not None else None
        except CookieError:  # malformed Cookie headers are simply unauthenticated
            return None


class AdminSessionMiddleware:
    """명시적으로 공개한 health/login 외의 현재·미래 HTTP route를 기본 차단한다."""

    def __init__(self, app: ASGIApp, auth: BuiltinAuth) -> None:
        self.app = app
        self.auth = auth

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.auth.enabled:
            await self.app(scope, receive, send)
            return
        method = scope["method"].upper()
        path = scope["path"]
        if method == "OPTIONS" or (method, path) in PUBLIC_REQUESTS:
            await self.app(scope, receive, send)
            return

        session = self.auth.verify(self.auth.cookie_token(scope))
        if session is None:
            await _json_error(scope, receive, send, 401, "authentication required")
            return
        if method in UNSAFE_METHODS:
            csrf = _header(scope, b"x-csrf-token")
            # 문자열 비교는 비 ASCII에서 터진다: 보낸 바이트 그대로 비교해 403으로 돌려보낸다.
            if csrf is None or not hmac.compare_digest(
                csrf.encode("latin-1"), session.csrf_token.encode("latin-1")
            ):
                await _json_error(
                    scope, receive, send, 403, "request verification failed"
                )
                return
        scope.setdefault("state", {})["admin_session"] = session
        await self.app(scope, receive, send)


def set_session_cookie(response: Any, token: str, settings: AuthSettings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def clear_session_cookie(response: Any, settings: AuthSettings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def _header(scope: Scope, wanted: bytes) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() == wanted:
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


async def _json_error(
    scope: Scope,
    receive: Receive,
    send: Send,
    status: int,
    detail: str,
) -> None:
    response = JSONResponse(
        {"detail": detail},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )
    await response(scope, receive, send)


__all__ = [
    "ADMIN_PASSWORD_ENV",
    "AUTH_MODE_ENV",
    "COOKIE_SECURE_ENV",
    "SESSION_COOKIE",
    "SESSION_SECRET_ENV",
    "SESSION_TTL_ENV",
    "AdminSession",
    "AdminSessionMiddleware",
    "AuthSettings",
    "BuiltinAuth",
    "clear_session_cookie",
    "set_session_cookie",
]
