import agentcanvas_contracts as contracts


def test_core_contracts_are_importable_from_the_package_root():
    assert {
        "AgentSpec",
        "AgentStatus",
        "ApprovalAnswer",
        "DEFAULT_NODE_TYPES",
        "EventType",
        "LocalizedText",
        "NodeType",
        "ReleaseManifest",
        "Run",
        "RunEvent",
        "ChunkRule",
        "DigestResult",
        "FullResult",
        "HttpCall",
        "HttpMethod",
        "McpCall",
        "RetrieveResult",
        "RunStatus",
        "SectionsResult",
        "ToolCall",
        "ToolDef",
        "compute_revision",
        "resolve_ports",
        "run_status",
    } <= set(contracts.__all__)


def test_every_patch_operation_is_reachable_from_the_package_root():
    """patch op은 한 벌이다 — 다섯만 내보내고 셋을 숨기면 소비자가 반쪽 계약을 본다."""
    assert {
        "AddNodeOperation",
        "RemoveNodeOperation",
        "ReplaceNodeConfigOperation",
        "AddEdgeOperation",
        "RemoveEdgeOperation",
        "AddResourceOperation",
        "ReplaceResourceOperation",
        "RemoveResourceOperation",
    } <= set(contracts.__all__)


def test_the_pattern_catalog_is_reachable_from_the_package_root():
    """엔진·API가 카탈로그를 읽는 길은 다른 카탈로그와 같은 자리에 있다."""
    assert {
        "DEFAULT_PATTERNS",
        "PatternDef",
        "resolve_pattern",
    } <= set(contracts.__all__)


def test_exported_names_exist():
    assert all(hasattr(contracts, name) for name in contracts.__all__)


def test_the_whole_skill_contract_is_reachable_from_the_package_root():
    """skill은 한 벌이다 — 모양만 내보내고 읽는 법을 숨기면 소비자가 반쪽 계약을 본다."""
    assert {
        "SkillDef",
        "SkillIssue",
        "SkillParse",
        "SkillRef",
        "SkillReference",
        "SkillSource",
        "parse_skill_markdown",
        "render_skill_markdown",
        "resolve_starter_skill",
        "starter_skills",
        "skill_refs",
    } <= set(contracts.__all__)
