from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from agentcanvas_api.sqlite_database import prepare_database, verify_database_backup
from agentcanvas_api.sqlite_eval_batch_store import SqliteEvalBatchStore
from agentcanvas_api.sqlite_eval_dataset_store import SqliteEvalDatasetStore
from agentcanvas_api.sqlite_run_store import SqliteRunStore
from agentcanvas_api.sqlite_store import SqliteSpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset
from agentcanvas_contracts.eval_result import EvalAttempt, EvalBatch, EvalCaseResult
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import EventType, RunEvent

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
AT = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)

_LEGACY_SCHEMA = """
CREATE TABLE spec_revisions (
    spec_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    revision TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (spec_id, version)
);
CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    spec_revision TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE run_events (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);
CREATE TABLE eval_datasets (
    dataset_id TEXT PRIMARY KEY,
    dataset_json TEXT NOT NULL
);
CREATE TABLE eval_batches (
    batch_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    batch_json TEXT NOT NULL
);
"""


def _objects() -> tuple[AgentSpec, Run, RunEvent, EvalDataset, EvalBatch]:
    spec = AgentSpec.model_validate(
        json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    )
    spec = spec.model_copy(update={"revision": spec.computed_revision()})
    run = Run(
        id="run-legacy",
        spec_id=spec.id,
        spec_revision=spec.revision,
        created_at=AT,
    )
    event = RunEvent(
        seq=0,
        run_id=run.id,
        event_type=EventType.NODE_STARTED,
        timestamp=AT,
        spec_revision=spec.revision,
        node_id="input",
        payload={"node_type": "core.input"},
    )
    dataset = EvalDataset(
        id="greetings",
        name="인사 데이터셋",
        cases=[
            EvalCase(
                id="case-1",
                title="인사",
                input={},
                expected_phrases=["반갑습니다"],
            )
        ],
    )
    batch = EvalBatch(
        id="batch-legacy",
        dataset_id=dataset.id,
        spec_id=spec.id,
        spec_revision=spec.revision,
        started_at=AT,
        results=[
            EvalCaseResult(
                case_id="case-1",
                attempts=[
                    EvalAttempt(
                        run_id=run.id,
                        passed=True,
                        output_text="반갑습니다",
                    )
                ],
                passed=True,
                evaluator="expected_phrases",
                evaluator_version="v1",
            )
        ],
    )
    return spec, run, event, dataset, batch


def _legacy_database(
    path: Path,
) -> tuple[AgentSpec, Run, RunEvent, EvalDataset, EvalBatch]:
    spec, run, event, dataset, batch = _objects()
    with sqlite3.connect(path) as connection:
        connection.executescript(_LEGACY_SCHEMA)
        connection.execute(
            "INSERT INTO spec_revisions"
            " (spec_id, version, revision, spec_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                spec.id,
                spec.version,
                spec.revision,
                json.dumps(spec.model_dump(mode="json"), ensure_ascii=False),
                AT.isoformat(),
            ),
        )
        connection.execute(
            "INSERT INTO runs (run_id, spec_id, spec_revision, created_at)"
            " VALUES (?, ?, ?, ?)",
            (run.id, run.spec_id, run.spec_revision, AT.isoformat()),
        )
        connection.execute(
            "INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)",
            (
                run.id,
                event.seq,
                json.dumps(event.model_dump(mode="json"), ensure_ascii=False),
            ),
        )
        connection.execute(
            "INSERT INTO eval_datasets (dataset_id, dataset_json) VALUES (?, ?)",
            (
                dataset.id,
                json.dumps(dataset.model_dump(mode="json"), ensure_ascii=False),
            ),
        )
        connection.execute(
            "INSERT INTO eval_batches (batch_id, dataset_id, batch_json)"
            " VALUES (?, ?, ?)",
            (
                batch.id,
                batch.dataset_id,
                json.dumps(batch.model_dump(mode="json"), ensure_ascii=False),
            ),
        )
    return spec, run, event, dataset, batch


def _assert_data_is_readable(
    path: Path,
    expected: tuple[AgentSpec, Run, RunEvent, EvalDataset, EvalBatch],
) -> None:
    spec, run, event, dataset, batch = expected
    assert SqliteSpecStore(path).latest(spec.id).spec == spec
    assert SqliteRunStore(path).get(run.id) == run
    assert SqliteRunStore(path).events(run.id) == [event]
    assert SqliteEvalDatasetStore(path).get(dataset.id) == dataset
    assert SqliteEvalBatchStore(path).get(batch.id) == batch


def test_migrated_data_can_be_read_written_and_restored_from_the_backup(
    tmp_path: Path,
):
    database = tmp_path / "agentcanvas.db"
    expected = _legacy_database(database)

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.backup_path is not None
    _assert_data_is_readable(database, expected)
    extra = expected[0].model_copy(update={"id": "after-migration"})
    extra = extra.model_copy(update={"revision": extra.computed_revision()})
    SqliteSpecStore(database).append(extra, AT)
    assert SqliteSpecStore(database).latest(extra.id).spec == extra

    restored = tmp_path / "restored.db"
    shutil.copy2(result.backup_path, restored)
    assert verify_database_backup(restored).schema_version == 0
    restored_result = prepare_database(
        restored, backup_dir=tmp_path / "restore-drill-backups"
    )

    assert restored_result.previous_version == 0
    _assert_data_is_readable(restored, expected)
