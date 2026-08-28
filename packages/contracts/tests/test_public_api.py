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


def test_exported_names_exist():
    assert all(hasattr(contracts, name) for name in contracts.__all__)
