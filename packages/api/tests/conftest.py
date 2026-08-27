from pathlib import Path

import pytest
from agentcanvas_adapters.anthropic_model import ANTHROPIC_API_KEY_REF
from agentcanvas_adapters.openai_model import OPENAI_API_KEY_REF
from agentcanvas_adapters.secrets import env_name
from agentcanvas_api.app import DB_PATH_ENV, LOCAL_MODEL_ENV
from agentcanvas_api.auth import AUTH_MODE_ENV

#: 시험이 진짜 그물을 타게 만드는 자리들 — 이 컴퓨터에 있어도 시험에서는 없는 것으로 본다.
WOULD_REACH_A_REAL_MODEL = [
    str(env_name(ANTHROPIC_API_KEY_REF)),
    str(env_name(OPENAI_API_KEY_REF)),
    LOCAL_MODEL_ENV,
]


@pytest.fixture
def anyio_backend() -> str:
    """비동기 시험은 asyncio 하나로 돈다 (서버가 도는 자리와 같다)."""
    return "asyncio"


@pytest.fixture(autouse=True)
def no_real_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """시험은 진짜 모델에게 말을 걸지 않는다 — 열쇠도, 내 컴퓨터에서 띄운 모델도 못 본 것으로 한다.

    서버를 만드는 자리는 띄운 자리의 설정을 보고 누구에게 물을지 정한다: 그대로 두면 시험이
    진짜 그물을 타고 돈을 쓴다.
    """
    for where in WOULD_REACH_A_REAL_MODEL:
        monkeypatch.delenv(where, raising=False)
    monkeypatch.setenv(DB_PATH_ENV, str(tmp_path / "agentcanvas.db"))
    # 기존 API 회귀는 각 도메인 계약을 검증한다. 인증 경계는 별도 acceptance에서 다룬다.
    monkeypatch.setenv(AUTH_MODE_ENV, "disabled")
