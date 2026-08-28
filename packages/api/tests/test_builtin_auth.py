"""문 앞을 지키는 자리 — 누구를 들이고 누구를 돌려보내는지.

컨테이너 smoke는 문이 잠겨 있다는 것만 밖에서 확인한다. 여기서는 밖에서 흔들어서는 드러나지
않는 갈림을 붙든다: 자격증명이 모자란 채로 뜨려는 서버, 위조·만료·부풀린 표, 시계가 조금
어긋난 자리, 그리고 아직 열리지 않은 길까지 기본으로 막혀 있는지.
"""

from __future__ import annotations

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.auth import (
    ADMIN_PASSWORD_ENV,
    AUTH_MODE_ENV,
    COOKIE_SECURE_ENV,
    SESSION_COOKIE,
    SESSION_SECRET_ENV,
    SESSION_TTL_ENV,
    AuthSettings,
    BuiltinAuth,
)
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"  # 12자 이상
SECRET = "s" * 32
OTHER_SECRET = "z" * 32
TTL = 3600


def an_environment(**changed: str) -> dict[str, str]:
    """자격증명이 모두 갖춰진 자리 — 시험마다 한 자리씩 무너뜨린다."""
    settled = {
        AUTH_MODE_ENV: "required",
        ADMIN_PASSWORD_ENV: PASSWORD,
        SESSION_SECRET_ENV: SECRET,
        SESSION_TTL_ENV: str(TTL),
    }
    settled.update(changed)
    return settled


def settings(**changed: object) -> AuthSettings:
    made = {
        "enabled": True,
        "admin_password": PASSWORD,
        "session_secret": SECRET.encode(),
        "session_ttl_seconds": TTL,
    }
    made.update(changed)
    return AuthSettings(**made)  # type: ignore[arg-type]


class Ticking:
    """시험이 손으로 돌리는 시계 — 만료와 시계 어긋남을 기다리지 않고 본다."""

    def __init__(self, now: float = 1_700_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def a_guard(clock: Ticking | None = None, **changed: object) -> BuiltinAuth:
    return BuiltinAuth(settings(**changed), clock=clock or Ticking())


def a_server(**changed: object) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            auth_settings=settings(**changed),
        )
    )


def logged_in(client: TestClient) -> str:
    """로그인해서 CSRF nonce를 받아 온다 — cookie는 client가 들고 있는다."""
    answer = client.post("/auth/login", json={"password": PASSWORD})
    assert answer.status_code == 200
    return answer.json()["csrf_token"]


class TestAServerThatWillNotStartWithoutCredentials:
    def test_a_password_shorter_than_twelve_characters_is_refused(self):
        with pytest.raises(RuntimeError, match=ADMIN_PASSWORD_ENV):
            AuthSettings.from_env(an_environment(**{ADMIN_PASSWORD_ENV: "a" * 11}))

    def test_a_password_nobody_set_is_refused(self):
        without = an_environment()
        del without[ADMIN_PASSWORD_ENV]

        with pytest.raises(RuntimeError, match=ADMIN_PASSWORD_ENV):
            AuthSettings.from_env(without)

    def test_a_session_secret_shorter_than_thirty_two_bytes_is_refused(self):
        with pytest.raises(RuntimeError, match=SESSION_SECRET_ENV):
            AuthSettings.from_env(an_environment(**{SESSION_SECRET_ENV: "s" * 31}))

    def test_a_session_secret_nobody_set_is_refused(self):
        without = an_environment()
        del without[SESSION_SECRET_ENV]

        with pytest.raises(RuntimeError, match=SESSION_SECRET_ENV):
            AuthSettings.from_env(without)

    def test_a_session_shorter_than_a_minute_is_refused(self):
        with pytest.raises(RuntimeError, match=SESSION_TTL_ENV):
            AuthSettings.from_env(an_environment(**{SESSION_TTL_ENV: "59"}))

    def test_a_session_longer_than_a_week_is_refused(self):
        with pytest.raises(RuntimeError, match=SESSION_TTL_ENV):
            AuthSettings.from_env(an_environment(**{SESSION_TTL_ENV: "604801"}))

    def test_the_edges_of_the_allowed_session_length_are_let_through(self):
        assert (
            AuthSettings.from_env(
                an_environment(**{SESSION_TTL_ENV: "60"})
            ).session_ttl_seconds
            == 60
        )
        assert (
            AuthSettings.from_env(
                an_environment(**{SESSION_TTL_ENV: "604800"})
            ).session_ttl_seconds
            == 604800
        )

    def test_a_session_length_that_is_not_a_number_is_refused(self):
        with pytest.raises(RuntimeError, match=SESSION_TTL_ENV):
            AuthSettings.from_env(an_environment(**{SESSION_TTL_ENV: "eight hours"}))

    def test_a_mode_nobody_recognises_is_refused(self):
        with pytest.raises(RuntimeError, match=AUTH_MODE_ENV):
            AuthSettings.from_env(an_environment(**{AUTH_MODE_ENV: "maybe"}))

    def test_a_cookie_setting_that_is_neither_yes_nor_no_is_refused(self):
        with pytest.raises(RuntimeError, match=COOKIE_SECURE_ENV):
            AuthSettings.from_env(an_environment(**{COOKIE_SECURE_ENV: "sometimes"}))

    def test_nothing_at_all_in_the_environment_still_means_locked(self):
        """빈 자리는 무인증이 아니라 기동 거부다 — fail-closed."""
        with pytest.raises(RuntimeError):
            AuthSettings.from_env({})

    def test_turning_it_off_must_be_said_out_loud(self):
        off = AuthSettings.from_env({AUTH_MODE_ENV: "disabled"})

        assert off.enabled is False


class TestTheTicketTheServerHandsOut:
    def test_the_ticket_it_just_wrote_is_the_one_it_accepts(self):
        guard = a_guard()

        token, issued = guard.issue()

        assert guard.verify(token) == issued

    def test_a_ticket_signed_by_someone_else_is_refused(self):
        forger = a_guard(session_secret=OTHER_SECRET.encode())
        forged, _ = forger.issue()

        assert a_guard().verify(forged) is None

    def test_a_ticket_whose_time_has_passed_is_refused(self):
        clock = Ticking()
        guard = a_guard(clock)
        token, _ = guard.issue()

        clock.now += TTL + 1

        assert guard.verify(token) is None

    def test_a_ticket_still_within_its_time_is_accepted(self):
        clock = Ticking()
        guard = a_guard(clock)
        token, _ = guard.issue()

        clock.now += TTL - 1

        assert guard.verify(token) is not None

    def test_a_ticket_that_claims_a_longer_life_than_allowed_is_refused(self):
        """같은 비밀로 서명됐더라도 허용된 기간보다 길게 적힌 표는 다시 걸러진다."""
        clock = Ticking()
        generous, _ = a_guard(clock, session_ttl_seconds=TTL * 2).issue()

        assert a_guard(clock).verify(generous) is None

    def test_a_ticket_written_thirty_seconds_ahead_is_still_accepted(self):
        """서버끼리 시계가 조금 어긋나는 것은 봐준다 — 30초까지."""
        clock = Ticking()
        ahead, _ = a_guard(Ticking(clock.now + 30)).issue()

        assert a_guard(clock).verify(ahead) is not None

    def test_a_ticket_written_further_ahead_than_that_is_refused(self):
        clock = Ticking()
        further, _ = a_guard(Ticking(clock.now + 31)).issue()

        assert a_guard(clock).verify(further) is None

    def test_no_ticket_at_all_is_refused(self):
        assert a_guard().verify(None) is None

    @pytest.mark.parametrize(
        "malformed",
        ["", "not-a-ticket", "no-dot-here", "payload.signature", "a.b.c", "."],
        ids=["empty", "words", "one-part", "unreadable", "three-parts", "dot"],
    )
    def test_a_ticket_that_is_not_even_shaped_right_is_refused(self, malformed: str):
        assert a_guard().verify(malformed) is None

    def test_an_absurdly_long_ticket_is_refused_without_reading_it(self):
        assert a_guard().verify("a" * 4097) is None


class TestThePasswordAtTheDoor:
    def test_the_password_the_server_was_given_is_the_one_it_takes(self):
        assert a_guard().password_matches(PASSWORD) is True

    def test_a_wrong_password_is_refused(self):
        assert a_guard().password_matches("wrong password here") is False

    def test_an_empty_password_is_refused(self):
        assert a_guard().password_matches("") is False

    def test_an_absurdly_long_password_is_refused_without_reading_it(self):
        assert a_guard().password_matches("a" * 4097) is False


class TestEveryDoorIsLockedUntilItIsOpened:
    @pytest.fixture
    def client(self) -> TestClient:
        return a_server()

    @pytest.mark.parametrize(
        "method, path",
        [
            ("GET", "/specs"),
            ("POST", "/specs"),
            ("GET", "/auth/session"),
            ("POST", "/auth/logout"),
            ("GET", "/a-route-that-does-not-exist"),
            ("DELETE", "/a-route-nobody-has-written-yet"),
        ],
    )
    def test_a_stranger_is_turned_away_from_any_path(
        self, client: TestClient, method: str, path: str
    ):
        answer = client.request(method, path)

        assert answer.status_code == 401

    def test_a_path_that_does_not_exist_says_nothing_about_itself(self, client):
        """없는 길이라는 사실조차 인증 전에는 알려주지 않는다 — 404가 아니라 401."""
        answer = client.get("/a-route-that-does-not-exist")

        assert answer.status_code == 401
        assert answer.json() == {"detail": "authentication required"}

    @pytest.mark.parametrize("path", ["/health/live", "/health/ready"])
    def test_the_health_probes_stay_open(self, client: TestClient, path: str):
        assert client.get(path).status_code == 200

    def test_the_login_door_stays_open(self, client: TestClient):
        assert (
            client.post("/auth/login", json={"password": PASSWORD}).status_code == 200
        )

    def test_a_wrong_password_at_the_open_door_is_still_refused(self, client):
        answer = client.post("/auth/login", json={"password": "not the password"})

        assert answer.status_code == 401

    def test_a_ticket_from_another_server_opens_nothing(self, client: TestClient):
        forged, _ = a_guard(session_secret=OTHER_SECRET.encode()).issue()

        answer = client.get("/specs", headers={"Cookie": f"{SESSION_COOKIE}={forged}"})

        assert answer.status_code == 401

    def test_a_cookie_header_that_makes_no_sense_is_simply_a_stranger(self, client):
        answer = client.get("/specs", headers={"Cookie": "=;;;garbage"})

        assert answer.status_code == 401


class TestWhichLayersStandIsBehindTheSameDoor:
    """EVAL_HONESTY 4 — 새로 낸 길도 기본 차단 그대로다(PUBLIC_REQUESTS에 넣지 않는다)."""

    @pytest.fixture
    def client(self) -> TestClient:
        return a_server()

    def test_a_stranger_cannot_ask_which_layers_stand(self, client: TestClient):
        assert client.get("/eval/evaluators").status_code == 401

    def test_the_admin_who_logged_in_can_ask(self, client: TestClient):
        logged_in(client)

        assert client.get("/eval/evaluators").status_code == 200


class TestUnsafeRequestsMustCarryTheNonce:
    @pytest.fixture
    def client(self) -> TestClient:
        return a_server()

    def test_a_logged_in_browser_without_the_nonce_is_refused(self, client):
        logged_in(client)

        answer = client.post("/specs", json={})

        assert answer.status_code == 403
        assert answer.json() == {"detail": "request verification failed"}

    def test_a_logged_in_browser_with_the_wrong_nonce_is_refused(self, client):
        logged_in(client)

        answer = client.post(
            "/specs", json={}, headers={"X-CSRF-Token": "not-the-nonce"}
        )

        assert answer.status_code == 403

    def test_a_nonce_full_of_strange_letters_is_refused_not_crashed(self, client):
        """비교할 수 없는 글자가 와도 문이 부서지지 않는다 — 403으로 돌려보낸다."""
        logged_in(client)

        answer = client.post(
            "/specs",
            json={},
            headers={"X-CSRF-Token": "not-ascii-é".encode("latin-1")},
        )

        assert answer.status_code == 403

    def test_the_right_nonce_lets_the_request_through(self, client: TestClient):
        nonce = logged_in(client)

        answer = client.post("/specs", json={}, headers={"X-CSRF-Token": nonce})

        assert answer.status_code not in (401, 403)

    def test_reading_needs_no_nonce(self, client: TestClient):
        logged_in(client)

        assert client.get("/auth/session").status_code == 200


class TestTheWholeRoundTrip:
    def test_login_then_read_the_session_then_log_out_and_be_a_stranger_again(self):
        client = a_server()

        nonce = logged_in(client)
        seen = client.get("/auth/session")
        assert seen.status_code == 200
        assert seen.json() == {"authenticated": True, "csrf_token": nonce}

        goodbye = client.post("/auth/logout", headers={"X-CSRF-Token": nonce})
        assert goodbye.status_code == 200
        assert goodbye.json()["authenticated"] is False

        assert client.get("/auth/session").status_code == 401

    def test_logging_out_takes_the_cookie_off_the_browser(self):
        client = a_server()
        nonce = logged_in(client)

        client.post("/auth/logout", headers={"X-CSRF-Token": nonce})

        assert client.cookies.get(SESSION_COOKIE) is None

    def test_the_cookie_it_hands_out_is_hidden_from_scripts_and_other_sites(self):
        client = a_server(cookie_secure=True)

        answer = client.post("/auth/login", json={"password": PASSWORD})

        written = answer.headers["set-cookie"].lower()
        assert "httponly" in written
        assert "samesite=strict" in written
        assert "secure" in written
