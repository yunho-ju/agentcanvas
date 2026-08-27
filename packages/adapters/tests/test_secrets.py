import pytest
from agentcanvas_adapters.secrets import SECRET_ENV_PREFIX, env_name, env_vault


def test_it_reads_the_name_the_ref_points_at():
    resolve = env_vault({"AGENTCANVAS_SECRET_ANTHROPIC_API_KEY": "sk-not-a-real-key"})

    assert resolve("secret://anthropic-api-key") == "sk-not-a-real-key"


def test_a_dash_in_the_name_is_an_underscore_where_the_server_keeps_it():
    assert env_vault({"AGENTCANVAS_SECRET_A_B": "kept"})("secret://a-b") == "kept"


def test_the_prefix_says_these_belong_to_this_product():
    assert SECRET_ENV_PREFIX == "AGENTCANVAS_SECRET_"


def test_a_secret_nobody_set_is_nothing_rather_than_a_crash():
    assert env_vault({})("secret://anthropic-api-key") is None


def test_an_empty_value_counts_as_nothing_set():
    """빈 값은 열쇠가 아니다 — 있는 척하고 부르면 진짜 이유가 가려진다."""
    assert env_vault({"AGENTCANVAS_SECRET_A": "   "})("secret://a") is None


@pytest.mark.parametrize(
    "not_a_ref",
    [
        "",
        "anthropic-api-key",
        "model://default",
        "SECRET://ANTHROPIC-API-KEY",
        "secret://has spaces",
        "secret://",
        "secret://a.b",
        "not a ref at all",
    ],
)
def test_only_a_secret_reference_is_ever_looked_up(not_a_ref):
    kept = {"AGENTCANVAS_SECRET_ANTHROPIC_API_KEY": "sk-not-a-real-key", "": "x"}

    assert env_vault(kept)(not_a_ref) is None


def test_this_vault_knows_no_revisions_so_it_looks_up_no_revision():
    """판을 적은 이름은 이 금고가 모르는 말이다 — 아무 열쇠나 내주지 않는다."""
    assert env_vault({"AGENTCANVAS_SECRET_A": "kept"})("secret://a@2") is None


def test_a_name_this_vault_could_never_look_up_is_not_a_name_it_takes():
    """`.`은 서버가 열쇠를 두는 자리에 쓸 수 없는 글자다 — 영영 안 풀릴 이름을 받아 두지 않는다."""
    assert env_name("secret://a.b") is None
