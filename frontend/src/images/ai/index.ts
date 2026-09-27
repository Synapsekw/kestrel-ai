/**
 * I-FA's public surface for the Images workspace (I-FW assembles it).
 *
 * Always mounted, once per workspace and **unconditionally**:
 * - `AiHosts` — the S session and the Shift+A / Shift+X bulk confirm. Once (two would run two
 *   sessions and two dialogs), and not behind the S tool, the hint bar or any other condition: the
 *   session must exist before S is pressed, and the confirm must open while the hint bar is hidden.
 * - `BatchDetectWatch` — reports the outcome of runs started from `BatchDetectDialog`.
 * - `ensureAiRegistered()` once, and `useAiWorkspace()` in the workspace host (its `keyHandlers` go
 *   first into FC's `useImagesKeymap`).
 *
 * Presentational (each renders nothing when it has nothing to show, and hosts no state of its own):
 * `AiBar`, `AiDetectButton`, `HintBar`, `ModelMenu`, `SamWarmEdge`, `SmartPolygonPanel`,
 * `SuggestionChip`, `SuggestionsLayer` (inside `ImageCanvas`, layer 3), `BatchDetectDialog`.
 */
export { AiBar } from "./AiBar";
export { AiDetectButton } from "./AiDetectButton";
export { AiHosts } from "./AiHosts";
export { useAiStore, useVisibility, type AiState } from "./aiStore";
export { BatchDetectDialog, type BatchDetectDialogProps, type BatchScope } from "./BatchDetectDialog";
export { BatchDetectWatch } from "./BatchDetectWatch";
export { HintBar } from "./HintBar";
export { ModelMenu } from "./ModelMenu";
export { ensureAiRegistered } from "./register";
export { SamWarmEdge } from "./SamWarmEdge";
export { SmartPolygonPanel } from "./SmartPolygonPanel";
export { SuggestionChip } from "./SuggestionChip";
export { SuggestionsLayer } from "./SuggestionsLayer";
export { visibleSuggestions, isPending, type Visibility } from "./suggestions";
export { useAiWorkspace, type AiWorkspaceOptions, type ImageIndexLike } from "./useAiWorkspace";
