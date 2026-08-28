"""Tool wrapper preview 서비스 — 붙여 넣은 API 설명을 연결 제안으로 옮긴다.

미리보기 게이트는 architect의 것을 그대로 쓴다 (`preview_of`). 여기 있는 것은
"어느 문서 위에서 물어보는가"뿐이다.
"""

from __future__ import annotations

from agentcanvas_adapters.tool_wrapper import (
    ToolSource,
    ToolWrapRequest,
    tool_wrapper_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.model_call import ModelCall

from .architect_service import ArchitectPreviewOutcome, preview_of


class ToolWrapperService:
    """모델에게 연결 patch를 물어보고, 성립하는 candidate만 미리 보여 준다."""

    def __init__(self, model: ModelCall) -> None:
        self._wrap = tool_wrapper_from(model)

    def preview(
        self,
        base_spec: AgentSpec,
        source: str,
        source_kind: ToolSource,
        model_ref: str,
    ) -> ArchitectPreviewOutcome:
        # 화면이 보낸 문서는 아직 저장되지 않은 지금의 캔버스다 — 판을 매기는 권위는
        # 저장에 있으므로, 이 미리보기 안에서만 통하는 base revision을 여기서 셈한다.
        base = base_spec.model_copy(update={"revision": base_spec.computed_revision()})
        asked = ToolWrapRequest(
            base_spec=base,
            source_kind=source_kind,
            source=source,
            model_ref=model_ref,
        )
        return preview_of(base, self._wrap(asked))


__all__ = ["ToolWrapperService"]
