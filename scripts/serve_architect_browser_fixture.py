"""Serve a secret-free, provider-free Guided Architect browser fixture.

This runner exists for real-browser wiring checks only.  It deliberately uses a
deterministic ModelCall and in-memory stores, and its output must never be
described as evidence from a real model provider.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from typing import Any

import uvicorn
from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.auth import AuthSettings
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid
from fastapi import Request
from fastapi.responses import JSONResponse

LOCAL_MODEL_ENV = "AGENTCANVAS_LOCAL_MODEL"
LOCAL_BASE_URL_ENV = "AGENTCANVAS_LOCAL_BASE_URL"
BASE_SPEC_MARKER = "Base AgentSpec:\n"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8022


@dataclass
class FixtureMetrics:
    """Non-secret counters used to produce bounded browser evidence."""

    model_calls: int = 0
    http_requests: int = 0


def local_model_configuration() -> tuple[str, ...]:
    """Return only the two explicit local-model env vars this fixture guards."""

    return tuple(
        name
        for name in (LOCAL_MODEL_ENV, LOCAL_BASE_URL_ENV)
        if os.environ.get(name, "").strip()
    )


def _base_spec_from_instruction(instruction: str | None) -> AgentSpec:
    """Read the canonical base JSON without retaining or logging the request text."""

    if instruction is None or BASE_SPEC_MARKER not in instruction:
        raise ValueError("fixture base spec was not present")
    _, _, encoded = instruction.partition(BASE_SPEC_MARKER)
    return AgentSpec.model_validate(json.loads(encoded))


def fixture_patch_for(ask: ModelAsk) -> AgentSpecPatch:
    """Build one valid, deterministic patch from the server-owned blank seed."""

    base = _base_spec_from_instruction(ask.instruction)
    return AgentSpecPatch.model_validate(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base.revision,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "fixture-router",
                        "type": "llm.router",
                        "position": {"x": 280, "y": 0},
                        "config": {
                            "model_ref": GUIDED_MODEL_REF,
                            "instruction": "Route the request to the fixture answer step.",
                        },
                    },
                },
                {
                    "op": "add_node",
                    "node": {
                        "id": "fixture-agent",
                        "type": "llm.agent",
                        "position": {"x": 560, "y": 0},
                        "config": {
                            "model_ref": GUIDED_MODEL_REF,
                            "instruction": "Produce a deterministic fixture answer.",
                        },
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "fixture-input-router",
                        "kind": "data",
                        "source": {"node": "core-input", "port": "request"},
                        "target": {"node": "fixture-router", "port": "input"},
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "fixture-router-agent",
                        "kind": "control",
                        "source": {"node": "fixture-router", "port": "passthrough"},
                        "target": {"node": "fixture-agent", "port": "messages"},
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "fixture-agent-output",
                        "kind": "data",
                        "source": {"node": "fixture-agent", "port": "response"},
                        "target": {"node": "core-output", "port": "input"},
                    },
                },
            ],
        }
    )


class FixtureArchitectModel:
    """A deterministic ModelCall; it never opens a provider client."""

    def __init__(self, metrics: FixtureMetrics | None = None) -> None:
        self.metrics = metrics or FixtureMetrics()

    def __call__(self, ask: ModelAsk) -> ModelSaid | ModelBalked:
        self.metrics.model_calls += 1
        try:
            patch = fixture_patch_for(ask)
        except (ValueError, TypeError, json.JSONDecodeError):
            return ModelBalked(
                reason="provider_error",
                message="fixture could not read the canonical base spec",
            )
        return ModelSaid(
            input_tokens=0,
            output_tokens=0,
            text=patch.model_dump_json(),
            evidence=None,
        )


def create_fixture_app() -> tuple[Any, FixtureArchitectModel, FixtureMetrics]:
    """Create the fixture API with no database or external provider wiring."""

    configured = local_model_configuration()
    if configured:
        names = ", ".join(configured)
        raise RuntimeError(f"fixture refuses local model configuration: {names}")

    metrics = FixtureMetrics()
    model = FixtureArchitectModel(metrics)
    specs = InMemorySpecStore()
    app = create_app(
        store=specs,
        run_store=InMemoryRunStore(),
        model=model,
        auth_settings=AuthSettings.disabled(),
    )

    @app.middleware("http")
    async def count_fixture_requests(request: Request, call_next):
        if request.url.path != "/__fixture/status":
            metrics.http_requests += 1
        return await call_next(request)

    @app.get("/__fixture/status")
    def fixture_status() -> JSONResponse:
        saved = specs.summaries(limit=100)
        return JSONResponse(
            {
                "fixture_only": True,
                "provenance": "scripted_candidate_not_real_provider_evidence",
                "model_calls": metrics.model_calls,
                "http_requests_excluding_status": metrics.http_requests,
                "saved_spec_ids": [summary.id for summary in saved],
                "saved_spec_count": len(saved),
            }
        )

    return app, model, metrics


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.host != DEFAULT_HOST:
        print("BLOCKED: fixture host must remain 127.0.0.1")
        return 2
    try:
        app, _, _ = create_fixture_app()
    except RuntimeError as error:
        print(f"BLOCKED: {error}")
        return 2

    print(
        "FIXTURE_ONLY: scripted Guided candidate; not real provider evidence; "
        "in-memory stores; no secrets or local model",
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "FixtureArchitectModel",
    "FixtureMetrics",
    "create_fixture_app",
    "fixture_patch_for",
    "local_model_configuration",
    "main",
]
