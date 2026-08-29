"""우리가 감싼 HTTP API를 진짜로 부르는 자리 — 전송은 주입해 결정론으로 시험한다."""

from __future__ import annotations

import json

import pytest
from agentcanvas_adapters.http_tool import (
    MAX_BODY_CHARS,
    SendFailed,
    ToolRequest,
    ToolResponse,
    sends_with_httpx,
)
from agentcanvas_adapters.tool_adapters import ADAPTER_BY_KIND, tools_from
from agentcanvas_contracts.agent_spec import Node, Position, ResourceBinding
from agentcanvas_contracts.tool_def import ToolDef
from agentcanvas_engine.tool_call import ToolAsk, ToolBalked, ToolReturned

KEY = "sk-live-do-not-log-me"
VAULT = {"AGENTCANVAS_SECRET_ARTICLE_API_KEY": KEY}


def a_tool(**overrides) -> ToolDef:
    return ToolDef.model_validate(
        {
            "name": "search_article",
            "plain_description": {"ko": "찾는다.", "en": "Finds."},
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
            },
            "output_schema": {"type": "object"},
            "timeout_ms": 2500,
            "call": {
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles",
            },
            **overrides,
        }
    )


def a_binding(kind: str = "http.api") -> ResourceBinding:
    return ResourceBinding.model_validate(
        {
            "id": "article-api",
            "kind": kind,
            "server_ref": "api://article-api"
            if kind == "http.api"
            else "mcp://article-api",
            "allowed_tools": [],
            "approval_policy": "read_only_auto",
            "tools": [],
        }
    )


def an_ask(
    tool: ToolDef | None = None, given: dict | None = None, kind: str = "http.api"
) -> ToolAsk:
    return ToolAsk(
        node=Node(
            id="lookup",
            type="tool.mcp",
            position=Position(x=0, y=0),
            config={"resource_ref": "article-api", "tool_name": "search_article"},
        ),
        binding=a_binding(kind),
        tool=tool if tool is not None else a_tool(),
        input=given if given is not None else {"query": "asthma"},
    )


def answers(status: int = 200, text: str = '{"articles": []}'):
    """무엇을 보냈는지 적어 두고 정해진 답을 돌려주는 전송."""
    sent: list[ToolRequest] = []

    def send(request: ToolRequest) -> ToolResponse:
        sent.append(request)
        return ToolResponse(status_code=status, text=text)

    return sent, send


def calling(send, env: dict | None = None):
    from agentcanvas_adapters.secrets import env_vault

    return tools_from(env_vault(env if env is not None else VAULT), send)


class TestBuildingTheRequest:
    def test_a_get_carries_the_values_as_a_query(self):
        sent, send = answers()

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolReturned)
        assert sent[0].method == "GET"
        assert sent[0].url == "https://api.example.com/articles"
        assert sent[0].params == {"query": "asthma"}
        assert sent[0].body is None

    def test_a_post_carries_the_values_as_a_body(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "POST",
                "url_template": "https://api.example.com/articles",
            }
        )

        calling(send)(an_ask(tool))

        assert sent[0].method == "POST"
        assert sent[0].body == {"query": "asthma"}
        assert sent[0].params == {}

    def test_values_the_address_asks_for_go_into_the_address(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles/{article_id}",
            }
        )

        calling(send)(an_ask(tool, {"article_id": "a-7", "query": "asthma"}))

        assert sent[0].url == "https://api.example.com/articles/a-7"
        # 주소에 실린 값은 물음표 뒤에 다시 붙지 않는다.
        assert sent[0].params == {"query": "asthma"}

    def test_a_value_cannot_climb_out_of_the_address_it_was_put_in(self):
        """치환할 값은 실행 입력이나 앞 노드가 낸 말이다 — 믿는 자리 밖의 글이다.

        그 값이 주소의 다른 칸으로 기어 올라가면, 문서에 적힌 곳이 아닌 데를 우리 열쇠를
        지고 부르게 된다(redirect를 따라가지 않는 것과 같은 부류의 일이다).
        """
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/t/{tenant}/articles/{article_id}",
            }
        )

        calling(send)(
            an_ask(tool, {"tenant": "acme", "article_id": "../../../admin/keys"})
        )

        assert sent[0].url == (
            "https://api.example.com/t/acme/articles/..%2F..%2F..%2Fadmin%2Fkeys"
        )
        assert "/admin/keys" not in sent[0].url

    def test_a_value_cannot_start_a_question_of_its_own(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles/{article_id}",
            }
        )

        calling(send)(an_ask(tool, {"article_id": "1?admin=true"}))

        assert sent[0].url == "https://api.example.com/articles/1%3Fadmin%3Dtrue"
        assert "?" not in sent[0].url

    def test_a_value_the_address_asks_for_but_nobody_gave_stops_the_call(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles/{article_id}",
            }
        )

        answer = calling(send)(an_ask(tool, {"query": "asthma"}))

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "missing_input"
        assert sent == []
        # 무엇이 없는지는 값의 **이름**으로 말한다 — 주소 원문을 까닭에 싣지 않는다.
        # (까닭은 이벤트에 남는다: 사람이 주소에 열쇠를 박아 두었으면 그것까지 남는다.)
        assert "article_id" in answer.message
        assert "https://" not in answer.message
        assert tool.call.url_template not in answer.message

    def test_the_tools_own_time_limit_is_what_the_call_waits(self):
        sent, send = answers()

        calling(send)(an_ask(a_tool(timeout_ms=2500)))

        assert sent[0].timeout_s == 2.5


class TestTheKey:
    def test_the_key_travels_in_the_header_and_nowhere_else(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles",
                "auth": "secret://article-api-key",
            }
        )

        answer = calling(send)(an_ask(tool))

        assert isinstance(answer, ToolReturned)
        assert sent[0].headers["Authorization"] == f"Bearer {KEY}"
        assert KEY not in sent[0].url
        assert KEY not in json.dumps(sent[0].params)
        assert KEY not in json.dumps(answer.result)

    def test_a_tool_that_needs_no_key_carries_no_such_header(self):
        sent, send = answers()

        calling(send)(an_ask())

        assert "Authorization" not in sent[0].headers

    def test_a_key_the_server_does_not_have_stops_the_call_and_says_so(self):
        sent, send = answers()
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles",
                "auth": "secret://article-api-key",
            }
        )

        answer = calling(send, env={})(an_ask(tool))

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "missing_secret"
        assert sent == []

    def test_the_reason_it_could_not_call_never_carries_the_key(self):
        _sent, send = answers(status=500, text=f"failed with {KEY}")
        tool = a_tool(
            call={
                "transport": "http",
                "method": "GET",
                "url_template": "https://api.example.com/articles",
                "auth": "secret://article-api-key",
            }
        )

        answer = calling(send)(an_ask(tool))

        assert isinstance(answer, ToolBalked)
        assert KEY not in answer.message


class TestWhenTheCallDoesNotGoWell:
    def test_waiting_too_long_is_a_timeout(self):
        def send(request: ToolRequest) -> SendFailed:
            return SendFailed(reason="timeout", message="waited 2.5s")

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "timeout"

    def test_not_reaching_the_server_is_told_as_trouble_on_the_way(self):
        def send(request: ToolRequest) -> SendFailed:
            return SendFailed(reason="unreachable", message="name not found")

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "http_error"

    @pytest.mark.parametrize("status", [301, 400, 404, 500, 503])
    def test_an_answer_that_is_not_a_yes_is_an_http_error(self, status: int):
        _sent, send = answers(status=status, text="no")

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "http_error"
        assert str(status) in answer.message

    def test_what_the_other_side_said_is_carried_but_only_so_much(self):
        _sent, send = answers(status=500, text="x" * (MAX_BODY_CHARS * 3))

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert len(answer.message) < MAX_BODY_CHARS * 2

    def test_a_yes_we_cannot_read_is_a_bad_answer(self):
        _sent, send = answers(status=200, text="<html>not json</html>")

        answer = calling(send)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "bad_output"


class TestWhatThisAdapterWillNotDo:
    def test_it_calls_once_and_never_tries_again(self):
        sent, send = answers(status=500, text="no")

        calling(send)(an_ask())

        assert len(sent) == 1

    def test_it_does_not_follow_a_move_somewhere_else(self):
        sent, send = answers(status=302, text="")

        answer = calling(send)(an_ask())

        assert len(sent) == 1
        assert isinstance(answer, ToolBalked)
        assert answer.reason == "http_error"

    def test_a_kind_of_connection_the_table_does_not_know_says_so(self):
        sent, send = answers()

        answer = calling(send)(an_ask(kind="mcp.toolset"))

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "no_adapter"
        assert sent == []

    def test_the_table_is_where_a_new_kind_of_connection_arrives(self):
        assert list(ADAPTER_BY_KIND) == ["http.api"]

    def test_a_tool_called_some_other_way_is_not_this_adapters_work(self):
        sent, send = answers()
        tool = a_tool(call={"transport": "mcp", "remote_name": "search_article"})

        answer = calling(send)(an_ask(tool))

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "no_adapter"
        assert sent == []


class TestTheTransportThatReallyGoesOut:
    """진짜 그물을 타는 자리 — 옵션과 사고 처리가 사는 유일한 곳이라 여기서 못 박는다."""

    def sent(self, monkeypatch, answer=None, blows_up: Exception | None = None):
        import httpx

        seen: dict[str, object] = {}

        def request(method: str, url: str, **options):
            seen["method"] = method
            seen["url"] = url
            seen.update(options)
            if blows_up is not None:
                raise blows_up
            return answer if answer is not None else httpx.Response(200, text="{}")

        monkeypatch.setattr(httpx, "request", request)
        return seen

    def a_request(self, **overrides) -> ToolRequest:
        return ToolRequest(
            **{
                "method": "GET",
                "url": "https://api.example.com/articles",
                "timeout_s": 2.5,
                "headers": {"Accept": "application/json"},
                "params": {"query": "asthma"},
                **overrides,
            }
        )

    def test_it_does_not_follow_a_move_somewhere_else(self, monkeypatch):
        seen = self.sent(monkeypatch)

        sends_with_httpx(self.a_request())

        assert seen["follow_redirects"] is False

    def test_it_waits_only_as_long_as_the_tool_said(self, monkeypatch):
        seen = self.sent(monkeypatch)

        sends_with_httpx(self.a_request(timeout_s=0.25))

        assert seen["timeout"] == 0.25

    def test_it_carries_the_values_as_values_not_as_more_address(self, monkeypatch):
        import httpx

        seen = self.sent(monkeypatch)

        sends_with_httpx(self.a_request(params={"query": "a&b=c"}))

        # 값은 주소에 붙여 보내지 않고 값으로 건넨다. 그 값을 주소로 옮기며 글자를 감싸는
        # 일은 httpx가 한다 — 우리가 기대는 그 행동을 여기서 함께 못 박는다.
        assert seen["params"] == {"query": "a&b=c"}
        assert "a%26b%3Dc" in str(
            httpx.Request("GET", seen["url"], params=seen["params"]).url
        )

    def test_what_the_other_side_said_comes_back_whole(self, monkeypatch):
        import httpx

        self.sent(monkeypatch, answer=httpx.Response(201, text='{"ok": true}'))

        answered = sends_with_httpx(self.a_request())

        assert answered == ToolResponse(status_code=201, text='{"ok": true}')

    def test_waiting_too_long_comes_back_as_a_value(self, monkeypatch):
        import httpx

        self.sent(monkeypatch, blows_up=httpx.ConnectTimeout("waited 2.5s"))

        answered = sends_with_httpx(self.a_request())

        assert isinstance(answered, SendFailed)
        assert answered.reason == "timeout"

    def test_a_road_that_does_not_exist_comes_back_as_a_value(self, monkeypatch):
        import httpx

        self.sent(monkeypatch, blows_up=httpx.ConnectError("name not found"))

        answered = sends_with_httpx(self.a_request())

        assert isinstance(answered, SendFailed)
        assert answered.reason == "unreachable"

    def test_an_address_that_is_not_an_address_comes_back_as_a_value(self, monkeypatch):
        """`InvalidURL`은 HTTPError가 아니다 — 그물이 아니라 우리 손의 문제라도 터지지 않는다."""
        import httpx

        self.sent(monkeypatch, blows_up=httpx.InvalidURL("no scheme"))

        answered = sends_with_httpx(self.a_request(url="not-an-address"))

        assert isinstance(answered, SendFailed)
        assert answered.reason == "unreachable"

    def test_a_tool_run_never_dies_of_the_transports_trouble(self, monkeypatch):
        """부르는 자리가 그 값을 실행의 까닭으로 옮긴다 — 실행은 남의 사정으로 터지지 않는다."""
        import httpx

        self.sent(monkeypatch, blows_up=httpx.InvalidURL("no scheme"))
        from agentcanvas_adapters.secrets import env_vault

        answer = tools_from(env_vault(VAULT), sends_with_httpx)(an_ask())

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "http_error"
