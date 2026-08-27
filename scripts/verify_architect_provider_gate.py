"""Opt-in, one-call live gate for the provider-backed Guided Architect flow.

This runner reads only the current process environment. It never loads an env file,
prints a credential, retries a provider call, or contacts a local model.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections.abc import Mapping
from time import perf_counter
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from agentcanvas_api.architect_service import (
    architect_request_fingerprint,
    blank_architect_seed,
)

OPENAI_KEY_ENV = "AGENTCANVAS_SECRET_OPENAI_API_KEY"
OPENAI_MODEL_ENV = "AGENTCANVAS_OPENAI_MODEL"
LOCAL_MODEL_ENV = "AGENTCANVAS_LOCAL_MODEL"
BASE_URL_ENV = "AGENTCANVAS_GATE_BASE_URL"
DEFAULT_BASE_URL = "http://127.0.0.1:8011"
GUIDED_MODEL_REF = "model://openai"
DRAFT_ID = "provider-gate-draft"
REQUEST = "고객 문의를 분류하고 답변 초안을 만들어줘"
TIMEOUT_SECONDS = 35


def _json_call(
    base_url: str, path: str, payload: Mapping[str, Any] | None = None
) -> tuple[int, object | None, int]:
    """Return status/body/elapsed without reading or exposing failed response bodies."""

    data = None
    headers = {"accept": "application/json"}
    method = "GET"
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["content-type"] = "application/json"
        method = "POST"
    started = perf_counter()
    try:
        with urlopen(
            Request(f"{base_url}{path}", data=data, headers=headers, method=method),
            timeout=TIMEOUT_SECONDS,
        ) as response:
            raw = response.read()
            body: object | None
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = None
            return (
                response.status,
                body,
                max(0, round((perf_counter() - started) * 1000)),
            )
    except HTTPError as error:
        # Do not read the provider/API error body: it may contain raw upstream detail.
        return error.code, None, max(0, round((perf_counter() - started) * 1000))
    except (TimeoutError, URLError, OSError):
        return 0, None, max(0, round((perf_counter() - started) * 1000))


def _list_state(base_url: str) -> tuple[dict[str, object] | None, str | None]:
    status, body, _ = _json_call(base_url, "/specs")
    if status != 200 or not isinstance(body, Mapping):
        return None, f"http_{status or 'unreachable'}"
    documents = body.get("documents")
    if not isinstance(documents, list):
        return None, "malformed_specs_listing"
    summary = [
        {
            "id": item.get("id"),
            "version": item.get("version"),
            "revision": item.get("revision"),
        }
        for item in documents
        if isinstance(item, Mapping)
    ]
    digest = hashlib.sha256(
        json.dumps(summary, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {"count": len(summary), "digest": digest}, None


def _price(name: str) -> float | None:
    written = os.environ.get(name, "").strip()
    if not written:
        return None
    try:
        value = float(written)
    except ValueError:
        return None
    return value if value >= 0 else None


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _blocked(reason: str) -> int:
    print(json.dumps({"status": "BLOCKED", "reason": reason}, sort_keys=True))
    return 2


def main() -> int:
    if not os.environ.get(OPENAI_KEY_ENV, "").strip():
        return _blocked("missing_exported_provider_credential")
    model_id = os.environ.get(OPENAI_MODEL_ENV, "").strip()
    if not model_id:
        return _blocked("missing_explicit_provider_model")
    if os.environ.get(LOCAL_MODEL_ENV, "").strip():
        return _blocked("local_model_is_forbidden_for_this_gate")

    base_url = os.environ.get(BASE_URL_ENV, DEFAULT_BASE_URL).rstrip("/")
    seed = blank_architect_seed(DRAFT_ID)
    fingerprint = architect_request_fingerprint(
        model_ref=GUIDED_MODEL_REF,
        request=REQUEST,
        base_revision=seed.revision,
    )

    before, error = _list_state(base_url)
    if error is not None or before is None:
        print(json.dumps({"status": "FAILED", "stage": "list_before", "error": error}))
        return 1

    draft_before, _, _ = _json_call(base_url, f"/specs/{DRAFT_ID}")
    if draft_before != 404:
        return _blocked("fixed_draft_id_is_already_persisted")

    status, body, http_latency_ms = _json_call(
        base_url,
        "/architect/draft",
        {
            "model_ref": GUIDED_MODEL_REF,
            "request": REQUEST,
            "draft_id": DRAFT_ID,
        },
    )
    if status != 200 or not isinstance(body, Mapping):
        print(
            json.dumps(
                {
                    "status": "FAILED",
                    "stage": "provider_request",
                    "http_status": status,
                    "http_latency_ms": http_latency_ms,
                },
                sort_keys=True,
            )
        )
        return 1

    candidate = body.get("candidate")
    patch = body.get("patch")
    evidence = body.get("evidence")
    operations = patch.get("operations") if isinstance(patch, Mapping) else None
    if not isinstance(candidate, Mapping) or not isinstance(patch, Mapping):
        print(json.dumps({"status": "FAILED", "stage": "malformed_candidate"}))
        return 1
    if not isinstance(evidence, Mapping):
        print(json.dumps({"status": "FAILED", "stage": "missing_live_evidence"}))
        return 1
    if candidate.get("id") != DRAFT_ID or not str(
        candidate.get("revision", "")
    ).startswith("sha256:"):
        print(json.dumps({"status": "FAILED", "stage": "candidate_identity"}))
        return 1
    allowed = {
        "add_node",
        "remove_node",
        "replace_node_config",
        "add_edge",
        "remove_edge",
    }
    if not isinstance(operations, list) or any(
        not isinstance(operation, Mapping) or operation.get("op") not in allowed
        for operation in operations
    ):
        print(json.dumps({"status": "FAILED", "stage": "patch_contract"}))
        return 1
    if (
        evidence.get("provider") != "openai_compatible"
        or evidence.get("model_ref") != GUIDED_MODEL_REF
        or evidence.get("model_id") != model_id
        or not isinstance(evidence.get("request_id"), str)
        or not evidence.get("request_id")
        or not _is_int(evidence.get("input_tokens"))
        or not _is_int(evidence.get("output_tokens"))
        or not _is_int(evidence.get("latency_ms"))
        or evidence.get("request_fingerprint") != fingerprint
        or evidence.get("external_state") != "preview_only"
        or evidence.get("persisted") is not False
        or evidence.get("watermark") != "not_applicable_json_candidate"
    ):
        print(json.dumps({"status": "FAILED", "stage": "evidence_contract"}))
        return 1

    draft_after, _, _ = _json_call(base_url, f"/specs/{DRAFT_ID}")
    after, error = _list_state(base_url)
    if draft_after != 404 or error is not None or after != before:
        print(
            json.dumps(
                {
                    "status": "FAILED",
                    "stage": "preview_persistence",
                    "draft_status": draft_after,
                    "listing_error": error,
                },
                sort_keys=True,
            )
        )
        return 1

    input_rate = _price("AGENTCANVAS_GATE_INPUT_USD_PER_MILLION")
    output_rate = _price("AGENTCANVAS_GATE_OUTPUT_USD_PER_MILLION")
    if input_rate is not None and output_rate is not None:
        estimated_cost = (
            int(evidence["input_tokens"]) * input_rate
            + int(evidence["output_tokens"]) * output_rate
        ) / 1_000_000
        cost = {
            "status": "estimated_from_process_price_snapshot",
            "estimated_usd": estimated_cost,
        }
    else:
        cost = {"status": "estimate_requires_price_snapshot", "estimated_usd": None}

    result = {
        "status": "CONFIRMED",
        "provider": evidence["provider"],
        "model_ref": evidence["model_ref"],
        "model_id": evidence["model_id"],
        "request_id_present": True,
        "input_tokens": evidence["input_tokens"],
        "output_tokens": evidence["output_tokens"],
        "server_latency_ms": evidence["latency_ms"],
        "http_latency_ms": http_latency_ms,
        "request_fingerprint": fingerprint,
        "preview_persistence": "404_and_listing_unchanged",
        "watermark": "not_applicable_json_candidate",
        "cost": cost,
        "account_billing": "UNVERIFIED",
        "run_id": uuid4().hex,
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
