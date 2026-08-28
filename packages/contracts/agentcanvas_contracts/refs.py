"""URI 스타일 참조 타입과 raw secret 금지 guard."""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import AfterValidator, Field

_REF_BODY = r"{scheme}://[A-Za-z0-9._-]+(?:@[A-Za-z0-9._-]+)?"


def _scheme_expression(schemes: tuple[str, ...]) -> str:
    """여러 scheme을 받는 ref도 정규식은 하나다 — 소비자가 볼 규칙이 갈라지지 않는다."""
    if len(schemes) == 1:
        return schemes[0]
    return f"(?:{'|'.join(schemes)})"


def _json_schema_pattern(schemes: tuple[str, ...]) -> str:
    """JSON Schema(ECMA-262)에 실을 표현 — 파이썬 밖에서도 같은 규칙이 지켜진다."""
    return rf"^{_REF_BODY.format(scheme=_scheme_expression(schemes))}$"


def _compiled_pattern(schemes: tuple[str, ...]) -> re.Pattern[str]:
    """같은 규칙의 파이썬 표현 — `\\Z`라야 `$`와 달리 후행 개행을 봐주지 않는다."""
    return re.compile(rf"\A{_REF_BODY.format(scheme=_scheme_expression(schemes))}\Z")


SECRET_FIELD_PATTERN = re.compile(
    r"secret|api_?key|token|password|credential", re.IGNORECASE
)
SECRET_SCHEME = "secret://"


def _shape_sentence(schemes: tuple[str, ...]) -> str:
    """사람이 읽을 형태 설명 — scheme이 여럿이면 고를 수 있는 형태를 모두 말한다."""
    return " or ".join(f"{scheme}://name[@revision]" for scheme in schemes)


def _ref_validator(schemes: tuple[str, ...]):
    pattern = _compiled_pattern(schemes)
    shape = _shape_sentence(schemes)

    def validate(value: str) -> str:
        if pattern.match(value) is None:
            raise ValueError(f"reference must look like {shape}, got {value!r}")
        return value

    return validate


def _ref_type(*schemes: str):
    """규칙을 지키는 곳은 AfterValidator 한 곳 — 사용자는 정규식 대신 문장을 읽는다.

    같은 규칙을 JSON Schema에도 pattern으로 실어 파이썬 밖 소비자가 알 수 있게 한다.
    """
    return Annotated[
        str,
        Field(json_schema_extra={"pattern": _json_schema_pattern(schemes)}),
        AfterValidator(_ref_validator(schemes)),
    ]


PromptRef = _ref_type("prompt")
ModelRef = _ref_type("model")
SchemaRef = _ref_type("schema")
McpRef = _ref_type("mcp")
SecretRef = _ref_type("secret")

# 도구 서버는 MCP 서버일 수도, 우리가 감싼 HTTP API일 수도 있다.
ServerRef = _ref_type("mcp", "api")


def no_raw_secrets[T](value: T, path: str = "", under_secret: bool = False) -> T:
    """secret처럼 보이는 키 아래에는 `secret://` ref 문자열만 허용한다.

    키가 한 번이라도 secret처럼 보이면 그 값의 모든 중첩 str leaf가 ref여야 한다
    (예: `{"api_keys": ["sk-..."]}`, `{"secret": {"value": "sk-..."}}` 모두 거부).
    """
    if isinstance(value, str):
        if under_secret and not value.startswith(SECRET_SCHEME):
            raise ValueError(
                f"field {path!r} must hold a '{SECRET_SCHEME}' reference, not a raw secret value"
            )
    elif isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else str(key)
            child_is_secret = under_secret or (
                isinstance(key, str) and bool(SECRET_FIELD_PATTERN.search(key))
            )
            no_raw_secrets(child, child_path, child_is_secret)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            no_raw_secrets(child, f"{path}[{index}]", under_secret)
    return value


__all__ = [
    "SECRET_FIELD_PATTERN",
    "SECRET_SCHEME",
    "McpRef",
    "ModelRef",
    "PromptRef",
    "SchemaRef",
    "SecretRef",
    "ServerRef",
    "no_raw_secrets",
]
