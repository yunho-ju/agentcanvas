"""Pydantic 모델에서 JSON Schema를 생성해 json_schema/ 에 커밋한다.

재생성: `python -m agentcanvas_contracts.schema_export`
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from .agent_spec import AgentSpec
from .architect_patch import AgentSpecPatch
from .chat import CHAT_SAID_BINDING
from .eval_case import EvalCase, EvalDataset
from .eval_result import EvalBatch
from .evaluator_catalog import DEFAULT_EVALUATOR_CATALOG, EvaluatorDef
from .instruction_catalog import DEFAULT_INSTRUCTION_CATALOG, InstructionPresetDef
from .model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from .node_registry import DEFAULT_NODE_TYPES, NodeType
from .optimization import OptimizationProposal
from .publication import SpecPublication
from .release import ReleaseManifest
from .run import ApprovalAnswer, Run
from .run_events import RunEvent
from .schema_catalog import DEFAULT_SCHEMA_CATALOG, SchemaDef

JSON_SCHEMA_DIR = Path(__file__).resolve().parent.parent / "json_schema"

SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "agent_spec": AgentSpec,
    "agent_spec_patch": AgentSpecPatch,
    "approval_answer": ApprovalAnswer,
    "eval_batch": EvalBatch,
    "eval_case": EvalCase,
    "eval_dataset": EvalDataset,
    "evaluator_def": EvaluatorDef,
    "instruction_preset_def": InstructionPresetDef,
    "model_def": ModelDef,
    "node_type": NodeType,
    "optimization_proposal": OptimizationProposal,
    "release_manifest": ReleaseManifest,
    "run": Run,
    "run_event": RunEvent,
    "schema_def": SchemaDef,
    "spec_publication": SpecPublication,
}

# 스키마가 아니라 데이터 — UI가 팔레트와 포트를 만드는 근거 (설계 문서 §4.2).
NODE_REGISTRY_NAME = "node_registry"

# 마찬가지로 데이터 — gate 승인 폼이 ref를 풀 때 보는 목록이다.
SCHEMA_CATALOG_NAME = "schema_catalog"

# 마찬가지로 데이터 — 많이 쓰는 모델을 고르게 할 때 보는 목록이다.
MODEL_CATALOG_NAME = "model_catalog"

# 마찬가지로 데이터 — 빈 상자 앞에서 고를 시작 글의 목록이다.
INSTRUCTION_CATALOG_NAME = "instruction_catalog"

# 마찬가지로 데이터 — 답이 맞았는지 무엇으로 확인할지 고르는 판정기 목록이다.
EVALUATOR_CATALOG_NAME = "evaluator_catalog"

# 마찬가지로 데이터 — 대화가 사람 말을 찾는 입력 이름 하나. 화면도 이 파일을 읽어
# 서버와 같은 철자를 쓴다 (Python↔TS 미러).
CHAT_CONTRACT_NAME = "chat_contract"


def render_schema(model: type[BaseModel]) -> str:
    return (
        json.dumps(
            model.model_json_schema(), indent=2, ensure_ascii=False, sort_keys=True
        )
        + "\n"
    )


def write_schemas(directory: Path = JSON_SCHEMA_DIR) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for name, model in SCHEMA_MODELS.items():
        path = directory / f"{name}.json"
        path.write_text(render_schema(model), encoding="utf-8")
        written.append(path)
    return written


def render_data(entries: dict[str, BaseModel]) -> str:
    """이름표로 찾아 쓰는 데이터 한 벌 — 언제나 같은 차례로 적어 diff가 흔들리지 않는다."""
    return (
        json.dumps(
            {
                name: entry.model_dump(mode="json")
                for name, entry in sorted(entries.items())
            },
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
    )


def write_data(name: str, entries: dict[str, BaseModel], directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.json"
    path.write_text(render_data(entries), encoding="utf-8")
    return path


def render_node_registry() -> str:
    return render_data(DEFAULT_NODE_TYPES)


def write_node_registry(directory: Path = JSON_SCHEMA_DIR) -> Path:
    return write_data(NODE_REGISTRY_NAME, DEFAULT_NODE_TYPES, directory)


def render_schema_catalog() -> str:
    return render_data(DEFAULT_SCHEMA_CATALOG)


def write_schema_catalog(directory: Path = JSON_SCHEMA_DIR) -> Path:
    return write_data(SCHEMA_CATALOG_NAME, DEFAULT_SCHEMA_CATALOG, directory)


def render_model_catalog() -> str:
    return render_data(DEFAULT_MODEL_CATALOG)


def write_model_catalog(directory: Path = JSON_SCHEMA_DIR) -> Path:
    return write_data(MODEL_CATALOG_NAME, DEFAULT_MODEL_CATALOG, directory)


def render_instruction_catalog() -> str:
    return render_data(DEFAULT_INSTRUCTION_CATALOG)


def write_instruction_catalog(directory: Path = JSON_SCHEMA_DIR) -> Path:
    return write_data(INSTRUCTION_CATALOG_NAME, DEFAULT_INSTRUCTION_CATALOG, directory)


def render_evaluator_catalog() -> str:
    return render_data(DEFAULT_EVALUATOR_CATALOG)


def write_evaluator_catalog(directory: Path = JSON_SCHEMA_DIR) -> Path:
    return write_data(EVALUATOR_CATALOG_NAME, DEFAULT_EVALUATOR_CATALOG, directory)


def render_chat_contract() -> str:
    return (
        json.dumps(
            {"said_binding": CHAT_SAID_BINDING},
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n"
    )


def write_chat_contract(directory: Path = JSON_SCHEMA_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{CHAT_CONTRACT_NAME}.json"
    path.write_text(render_chat_contract(), encoding="utf-8")
    return path


if __name__ == "__main__":  # pragma: no cover
    for path in [
        *write_schemas(),
        write_chat_contract(),
        write_node_registry(),
        write_schema_catalog(),
        write_model_catalog(),
        write_instruction_catalog(),
        write_evaluator_catalog(),
    ]:
        print(path)
