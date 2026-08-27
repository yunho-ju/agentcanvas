"""서버만 아는 열쇠를 이름으로 찾아 주는 금고 — 그래프에는 이름만 적히고, 값은 여기 산다.

가장 작은 금고는 서버를 띄운 자리의 환경변수다: `secret://anthropic-api-key`는
`AGENTCANVAS_SECRET_ANTHROPIC_API_KEY`에서 나온다. 이 층은 순수하다 — 환경을 스스로 읽지
않고 받은 것만 본다(진짜 환경을 읽는 일은 서버를 조립하는 가장자리에서 한다).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping

#: 서버가 이 제품의 열쇠를 두는 자리의 머리말.
SECRET_ENV_PREFIX = "AGENTCANVAS_SECRET_"

#: 이 금고가 알아듣는 이름 — `secret://` 하나뿐이고, 판(@revision)은 모른다.
#: 서버가 열쇠를 두는 자리에 쓸 수 있는 글자만 받는다(`.`은 쓸 수 없다): 영영 안 풀릴 이름을
#: 받아 두면 열쇠를 넣어 둔 사람이 왜 안 되는지 끝내 알 수 없다.
SECRET_NAME = re.compile(r"^secret://([A-Za-z0-9_-]+)$")

#: 이름 하나를 열쇠로 바꿔 주는 것 — 모르면 없다고 답한다 (터지지 않는다).
SecretResolver = Callable[[str], str | None]


def env_name(ref: str) -> str | None:
    """그 이름의 열쇠가 서버의 어느 자리에 있는지 — 이름이 아니면 어느 자리도 아니다."""
    named = SECRET_NAME.match(ref)
    if named is None:
        return None
    return SECRET_ENV_PREFIX + named.group(1).replace("-", "_").upper()


def env_vault(env: Mapping[str, str]) -> SecretResolver:
    """서버를 띄운 자리가 들고 있는 열쇠들 — 이름을 대면 값을 내주는 금고가 된다.

    비어 있는 값은 열쇠가 아니다: 있는 척하고 부르면 진짜 까닭(열쇠가 없다)이 가려진다.
    """

    def resolve(ref: str) -> str | None:
        where = env_name(ref)
        if where is None:
            return None
        kept = env.get(where, "").strip()
        return kept or None

    return resolve


__all__ = [
    "SECRET_ENV_PREFIX",
    "SECRET_NAME",
    "SecretResolver",
    "env_name",
    "env_vault",
]
