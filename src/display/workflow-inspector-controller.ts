import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, isKeyRelease, isKeyRepeat, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { WorkflowSnapshot } from "../runtime.ts";
import {
  defaultWorkflowInspectorState,
  reduceWorkflowInspectorState,
  renderWorkflowInspector,
  type WorkflowInspectorInput,
  type WorkflowInspectorState,
} from "./workflow-inspector.ts";
import type { ProgressTheme } from "./progress.ts";

export interface WorkflowInspector {
  update: (snapshot: WorkflowSnapshot) => void;
  render: (tui: TUI, theme: ProgressTheme, width: number, progressLines: string[]) => string[];
  isOpen: () => boolean;
  dispose: () => void;
}

export function createWorkflowInspector(
  ctx: ExtensionCommandContext,
  actions: { pause: () => void; save: () => void; stop: () => void },
): WorkflowInspector {
  let snapshot: WorkflowSnapshot | undefined;
  let state: WorkflowInspectorState = defaultWorkflowInspectorState();
  let suppressAbortUntil = 0;
  let requestRender: (() => void) | undefined;

  const openInspector = (): void => {
    if (!snapshot) {
      ctx.ui.notify("No workflow snapshot is available yet.", "info");
      return;
    }
    state = { ...state, level: "phases" };
    requestRender?.();
  };

  const closeInspector = (): void => {
    if (state.level === "chat") return;
    state = { ...state, level: "chat" };
    suppressAbortUntil = Date.now() + 100;
    requestRender?.();
  };

  const applyInput = (input: WorkflowInspectorInput): void => {
    if (!snapshot) return;
    const nextState = reduceWorkflowInspectorState(state, snapshot, input);
    if (nextState.level === "chat" && state.level !== "chat") suppressAbortUntil = Date.now() + 100;
    state = nextState;
    requestRender?.();
  };

  const renderInspector = (tui: TUI, theme: ProgressTheme, width: number, progressLines: string[]): string[] => {
    requestRender = () => tui.requestRender();
    if (!snapshot) return progressLines;
    if (state.level === "chat") return renderWorkflowInspector(snapshot, state, width, 2, theme);
    return renderWorkflowInspector(snapshot, state, width, inspectorPaneHeight(tui.terminal.rows), theme);
  };

  const unsubscribe = ctx.ui.onTerminalInput((data) => {
    if (isKeyRelease(data)) return state.level !== "chat" ? { consume: true } : undefined;
    const repeatedKey = isKeyRepeat(data);
    const inspectorToggleKey = matchesKey(data, Key.ctrl("\\")) || matchesKey(data, Key.f2) || matchesKey(data, Key.alt("o"));
    if (!repeatedKey && inspectorToggleKey) {
      if (state.level === "chat") openInspector();
      else closeInspector();
      return { consume: true };
    }
    if (repeatedKey && inspectorToggleKey) return { consume: true };
    if (state.level === "chat") {
      if (!repeatedKey && matchesKey(data, Key.left)) {
        openInspector();
        return { consume: true };
      }
      return undefined;
    }
    if (!repeatedKey && data === "x") {
      actions.stop();
      return { consume: true };
    }
    if (!repeatedKey && data === "p") {
      actions.pause();
      return { consume: true };
    }
    if (!repeatedKey && data === "s") {
      actions.save();
      return { consume: true };
    }
    const input = workflowInspectorInputForKey(data, repeatedKey);
    if (!input) return undefined;
    applyInput(input);
    return { consume: true };
  });

  return {
    update(next) {
      snapshot = next;
      requestRender?.();
    },
    render: renderInspector,
    isOpen: () => state.level !== "chat" || Date.now() < suppressAbortUntil,
    dispose() {
      unsubscribe();
    },
  };
}

function workflowInspectorInputForKey(data: string, repeatedKey: boolean): WorkflowInspectorInput | undefined {
  if (!repeatedKey && (matchesKey(data, Key.escape) || data === "q")) return "escape";
  if (matchesKey(data, Key.up)) return "up";
  if (matchesKey(data, Key.down)) return "down";
  if (data === "\n" || data === "\r") return "enter";
  if (matchesKey(data, Key.right) || data === "l") return "right";
  if (data === "j") return "scrollDown";
  if (data === "k") return "scrollUp";
  return undefined;
}

function inspectorPaneHeight(termRows: number): number {
  const safeRows = termRows > 0 ? termRows : 32;
  return Math.max(14, safeRows - 4);
}
