"""URI 스타일 참조 타입과 raw secret 금지 guard."""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import AfterValidator

_REF_PATTERN = re.compile(
    r"^(?P<scheme>[a-z]+)://(?P<name>[A-Za-z0-9._-]+)(?:@(?P<revision>[A-Za-z0-9._-]+))?$"
)

SECRET_FIELD_PATTERN = re.compile(
    r"secret|api_?key|token|password|credential", re.IGNORECASE
)
SECRET_SCHEME = "secret://"


def _ref_validator(scheme: str):
    def validate(value: str) -> str:
        match = _REF_PATTERN.match(value)
        if match is None or match.group("scheme") != scheme:
            raise ValueError(
                f"reference must look like {scheme}://name[@revision], got {value!r}"
            )
        return value

    return validate


PromptRef = Annotated[str, AfterValidator(_ref_validator("prompt"))]
ModelRef = Annotated[str, AfterValidator(_ref_validator("model"))]
SchemaRef = Annotated[str, AfterValidator(_ref_validator("schema"))]
McpRef = Annotated[str, AfterValidator(_ref_validator("mcp"))]
SecretRef = Annotated[str, AfterValidator(_ref_validator("secret"))]


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
    "no_raw_secrets",
]
