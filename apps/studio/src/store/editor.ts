// 편집 화면의 상태 전체 — 슬라이스를 하나로 모으고, 화면이 자주 묻는 것에 답한다.
import { create } from "zustand";
import { selectedEdgeOf, selectedNodeOf } from "../graph/selection";
import type { FlowEdge, FlowNode } from "../graph/serialize";
import { type DetachSlice, createDetachSlice } from "./detachSlice";
import { type ArchitectSlice, createArchitectSlice } from "./architectSlice";
import { type EvalSlice, createEvalSlice } from "./evalSlice";
import { type EvalSuggestSlice, createEvalSuggestSlice } from "./evalSuggestSlice";
import { type EvalDatasetSlice, createEvalDatasetSlice } from "./evalDatasetSlice";
import { type EvalHistorySlice, createEvalHistorySlice } from "./evalHistorySlice";
import { type EvalStandingSlice, createEvalStandingSlice } from "./evalStandingSlice";
import { type FirstStepsSlice, createFirstStepsSlice } from "./firstStepsSlice";
import { type FeedbackSlice, createFeedbackSlice } from "./feedbackSlice";
import { type GateSlice, createGateSlice } from "./gateSlice";
import { type GraphSlice, createGraphSlice } from "./graphSlice";
import { type HintSlice, createHintSlice } from "./hintSlice";
import { type HistorySlice, createHistorySlice } from "./historySlice";
import { type RunInputSlice, createRunInputSlice } from "./runInputSlice";
import { type OpenSlice, createOpenSlice } from "./openSlice";
import { type PickerSlice, createPickerSlice } from "./pickerSlice";
import { type RunSlice, createRunSlice } from "./runSlice";
import { type SaveSlice, createSaveSlice } from "./saveSlice";
import { type SelectionSlice, createSelectionSlice } from "./selectionSlice";
import { type ToolWrapSlice, createToolWrapSlice } from "./toolWrapSlice";
import { type ViewSlice, createViewSlice } from "./viewSlice";

export type EditorState = GraphSlice &
  HistorySlice &
  SelectionSlice &
  DetachSlice &
  RunSlice &
  RunInputSlice &
  GateSlice &
  FeedbackSlice &
  SaveSlice &
  OpenSlice &
  PickerSlice &
  ViewSlice &
  HintSlice &
  FirstStepsSlice &
  EvalSlice &
  EvalSuggestSlice &
  EvalDatasetSlice &
  EvalHistorySlice &
  EvalStandingSlice &
  ArchitectSlice &
  ToolWrapSlice;

export function selectedNode(state: EditorState): FlowNode | undefined {
  return selectedNodeOf(state);
}

export function selectedEdge(state: EditorState): FlowEdge | undefined {
  return selectedEdgeOf(state);
}

export const useEditor = create<EditorState>()((...args) => ({
  ...createArchitectSlice(...args),
  ...createToolWrapSlice(...args),
  ...createHistorySlice(...args),
  ...createSelectionSlice(...args),
  ...createDetachSlice(...args),
  ...createRunSlice(...args),
  ...createRunInputSlice(...args),
  ...createGateSlice(...args),
  ...createFeedbackSlice(...args),
  ...createSaveSlice(...args),
  ...createOpenSlice(...args),
  ...createPickerSlice(...args),
  ...createViewSlice(...args),
  ...createHintSlice(...args),
  ...createFirstStepsSlice(...args),
  ...createEvalSlice(...args),
  ...createEvalSuggestSlice(...args),
  ...createEvalDatasetSlice(...args),
  ...createEvalHistorySlice(...args),
  ...createEvalStandingSlice(...args),
  ...createGraphSlice(...args),
}));
