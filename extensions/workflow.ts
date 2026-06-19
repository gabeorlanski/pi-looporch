import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  getMarkdownTheme,
  getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Editor,
  Key,
  SettingsList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type SettingItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows, workflowRootsForProject } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { type GeneratedWorkflowDraft, type WorkflowReviewer, type WorkflowReviewDecision } from "../src/request.ts";
import { createWorkflowRunId, createWorkflowRunLog, type WorkflowRunLog } from "../src/run-logs.ts";
import { normalizeWorkflowName, runWorkflowFromDirectory, type WorkflowSnapshot } from "../src/runtime.ts";
import { WorkflowInputError, extractWorkflowInputContract, parseWorkflowInput, validateWorkflowInput } from "../src/input.ts";
import { completeMessage, failureMessage } from "../src/display/messages.ts";
import { initialProgressDisplay, progressDisplay, type ProgressDisplay, type ProgressTheme } from "../src/display/progress.ts";
import { agentInspectorHeaderLines } from "../src/display/agent-inspector.ts";
import { approvalLines } from "../src/display/approval.ts";
import { parseWorkflowOutline } from "../src/workflow-outline.ts";
import {
  buildChangeRequest,
  defaultExpanded,
  flattenReviewNodes,
  renderWorkflowReview,
  reviewHasFeedback,
  type ReviewComment,
  type ReviewNode,
} from "../src/display/workflow-review.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { writeWorkflowSessionSummary } from "../src/session-logs.ts";
import { readProjectWorkflowSettings, writeProjectWorkflowSettings, type WorkflowSettings } from "../src/workflow-settings.ts";

const MESSAGE_TYPE = "pi-workflow-message";
const RUNNING_WORKFLOW_WIDGET = "pi-workflow-running";
const RUNNING_WORKFLOW_STATUS = "workflow";

export default function piWorkflow(pi: ExtensionAPI) {
  const aliases = new Set<string>();

  for (const tool of createWorkflowTools({
    agentForContext: (ctx) => createPiWorkflowAgent({ cwd: ctx.cwd, reviewer: createReviewer(ctx) }),
    reviewerForContext: (ctx) => createReviewer(ctx),
  })) {
    pi.registerTool(tool);
  }

  pi.registerCommand("workflow", {
    description: "Run or create a project workflow in the current session",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => steerWorkflowCommand(pi, ctx, undefined, args),
  });

  pi.registerCommand("workflow-review", {
    description: "Inspect an existing workflow definition",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => reviewWorkflowCommand(pi, ctx, args),
  });

  pi.registerCommand("workflow-settings", {
    description: "Configure project workflow settings",
    handler: async (args, ctx) => workflowSettingsCommand(ctx, args),
  });

  pi.on("session_start", async (_event, ctx) => {
    for (const workflow of await discoverWorkflows(ctx.cwd)) {
      const command = `workflow:${workflow.name}`;
      if (aliases.has(command)) continue;
      aliases.add(command);
      pi.registerCommand(command, {
        description: workflow.metadata.description,
        handler: async (args, commandCtx) => steerWorkflowCommand(pi, commandCtx, workflow.name, args),
      });
    }
  });
}

async function steerWorkflowCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
): Promise<void> {
  if (fixedWorkflowName) {
    await runExistingWorkflowCommand(pi, ctx, normalizeWorkflowName(fixedWorkflowName), args);
    return;
  }

  const workflows = await discoverWorkflows(ctx.cwd);
  const names = workflows.map((workflow) => workflow.name);
  const trimmed = args.trim();
  if (!trimmed) {
    ctx.ui.notify(names.length ? `Usage: /workflow <name> [input]. Available: ${names.join(", ")}` : "No workflows found.", "warning");
    return;
  }

  const [first, rest] = splitFirstWord(trimmed);
  if (names.includes(first)) {
    await runExistingWorkflowCommand(pi, ctx, first, rest);
    return;
  }

  ctx.ui.notify("Workflow request sent to current session", "info");
  sendWhenReady(pi, ctx, naturalLanguageRequestMessage(trimmed, names));
}

async function runExistingWorkflowCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflowName: string,
  rawInput: string,
): Promise<void> {
  const reviewer = createReviewer(ctx);
  const workflow = (await discoverWorkflows(ctx.cwd)).find((candidate) => candidate.name === workflowName);
  if (!workflow) {
    ctx.ui.notify(`Workflow '${workflowName}' not found.`, "warning");
    return;
  }
  let runLog: WorkflowRunLog | undefined;
  let lastSnapshot: WorkflowSnapshot | undefined;
  const inspector = createWorkflowInspector(ctx);
  const abortControls = createWorkflowAbortControls(ctx, () => inspector.isOpen());
  try {
    const commandOptions = parseWorkflowCommandOptions(rawInput);
    const source = await readFile(workflow.entryFile, "utf8");
    const inputContract = extractWorkflowInputContract(source);
    const parsedInput = parseWorkflowInput(commandOptions.rawInput);
    if (parsedInput.action === "resolve") {
      ctx.ui.notify(`Workflow '${workflowName}' input resolution sent to current session`, "info");
      sendWhenReady(
        pi,
        ctx,
        steerableInputResolutionMessage({
          rawInput: parsedInput.rawInput,
          workflowName,
          metadata: workflow.metadata,
          contract: inputContract,
        }),
      );
      return;
    }
    const input = validateWorkflowInput(parsedInput.input, workflowName, inputContract);
    const parentRunId = createWorkflowRunId(workflowName);
    const workflowSettings = await readProjectWorkflowSettings(ctx.cwd);
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd, reviewer });
    if (commandOptions.saveLog) {
      runLog = await createWorkflowRunLog({
        cwd: ctx.cwd,
        workflowName,
        workflowDir: workflow.dir,
        metadata: workflow.metadata,
        source,
        input,
        runId: parentRunId,
      });
      ctx.ui.notify(`Saving workflow log to ${relativeToProject(ctx.cwd, runLog.runDir)}`, "info");
    }
    ctx.ui.notify(`Running workflow '${workflowName}'`, "info");
    updateRunningWorkflowUi(ctx, (width, theme) => initialProgressDisplay(workflowName, width, theme, input), inspector);
    const result = await runWorkflowFromDirectory({
      cwd: ctx.cwd,
      workflowName,
      input,
      agent,
      workflowRoots: await workflowRootsForProject(ctx.cwd),
      agentLogParentId: parentRunId,
      maxParallelAgents: workflowSettings.maxParallelAgents,
      signal: abortControls.signal,
      onEvent: (event) => runLog?.recordEvent(event),
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot;
        inspector.update(snapshot);
        updateRunningWorkflowUi(ctx, (width, theme) => progressDisplay(snapshot, width, theme), inspector);
      },
    });
    await runLog?.complete(result.result, result.snapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    const sessionLogDir = await writeWorkflowSessionSummary({
      cwd: ctx.cwd,
      parentId: parentRunId,
      snapshot: result.snapshot,
      result: result.result,
    });
    const sessionLogMessage = workflowSessionLogMessage(sessionLogDir);
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: `${withWorkflowLogPath(completeMessage(result.workflowName, result.result), logPath)}\n\n${sessionLogMessage}`,
      display: true,
      details: { workflowName: result.workflowName, result: result.result, snapshot: result.snapshot, logPath, sessionLogDir },
    });
    sendUserMessageWhenReady(pi, ctx, sessionLogMessage);
  } catch (error) {
    await runLog?.fail(error, lastSnapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    const message = withWorkflowLogPath(error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error), logPath);
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName, logPath } });
  } finally {
    inspector.dispose();
    abortControls.dispose();
    clearRunningWorkflowUi(ctx);
  }
}

function createWorkflowAbortControls(
  ctx: ExtensionCommandContext,
  shouldIgnoreEscape: () => boolean = () => false,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortWorkflow = () => {
    if (controller.signal.aborted) return;
    controller.abort();
  };
  const removeHostAbortListener = ctx.signal
    ? (() => {
        ctx.signal.addEventListener("abort", abortWorkflow, { once: true });
        return () => ctx.signal?.removeEventListener("abort", abortWorkflow);
      })()
    : () => undefined;
  const unsubscribeInput = ctx.ui.onTerminalInput((data) => {
    if (!matchesKey(data, Key.escape) || shouldIgnoreEscape()) return undefined;
    abortWorkflow();
    ctx.abort();
    ctx.ui.notify("Aborting workflow run", "warning");
    return { consume: true };
  });
  return {
    signal: controller.signal,
    dispose() {
      unsubscribeInput();
      removeHostAbortListener();
    },
  };
}

interface WorkflowInspector {
  update: (snapshot: WorkflowSnapshot) => void;
  render: (tui: TUI, theme: ProgressTheme, width: number, progressLines: string[]) => string[];
  isOpen: () => boolean;
  dispose: () => void;
}

function createWorkflowInspector(ctx: ExtensionCommandContext): WorkflowInspector {
  let snapshot: WorkflowSnapshot | undefined;
  let open = false;
  let selected = 0;
  let scroll = 0;
  let viewport = 0;
  let maxScroll = 0;
  let suppressAbortUntil = 0;
  let requestRender: (() => void) | undefined;

  const toggleInspector = (): void => {
    if (!snapshot || snapshot.agents.length === 0) {
      ctx.ui.notify("No workflow agent transcript is available yet.", "info");
      return;
    }
    open = !open;
    selected = Math.min(selected, snapshot.agents.length - 1);
    if (open) scroll = 0;
    requestRender?.();
  };

  const closeInspector = (): void => {
    if (!open) return;
    open = false;
    suppressAbortUntil = Date.now() + 100;
    requestRender?.();
  };

  const renderTranscriptPane = (tui: TUI, theme: ProgressTheme, width: number, height: number): string[] => {
    if (!snapshot || snapshot.agents.length === 0)
      return fillPane(agentInspectorHeaderLines(snapshot ?? emptySnapshot(), 0, width, theme), width, height);
    selected = Math.min(selected, snapshot.agents.length - 1);
    const header = agentInspectorHeaderLines(snapshot, selected, width, theme);
    const agent = snapshot.agents[selected];
    const messages = Array.isArray(agent.messages) ? agent.messages : [];
    const body =
      messages.length > 0 ? renderAgentTranscript(messages, tui, ctx.cwd, width) : [theme.fg("dim", "  (no activity captured yet)")];
    viewport = Math.max(3, height - header.length - 1);
    maxScroll = Math.max(0, body.length - viewport);
    const offset = Math.min(scroll, maxScroll);
    const start = Math.max(0, body.length - viewport - offset);
    const visible = body.slice(start, start + viewport);
    const shownEnd = start + visible.length;
    const footer = theme.fg(
      "dim",
      `  lines ${String(shownEnd)}/${String(body.length)}${maxScroll > 0 ? (offset > 0 ? " · ↑↓ scroll" : " · live (newest)") : ""} · Ctrl+\\ close`,
    );
    return fillPane([...header, ...visible, footer], width, height);
  };

  const renderSplit = (tui: TUI, theme: ProgressTheme, width: number, progressLines: string[]): string[] => {
    requestRender = () => tui.requestRender();
    if (!open) return progressLines;
    const height = transcriptPaneHeight(tui.terminal.rows);
    if (width < 120) {
      const progressHeight = Math.max(6, Math.floor(height / 2));
      return [
        ...fitProgressPane(progressLines, width, progressHeight, theme),
        theme.fg("borderMuted", truncateToWidth("─".repeat(width), width)),
        ...renderTranscriptPane(tui, theme, width, height - progressHeight),
      ];
    }
    const gutter = theme.fg("borderMuted", " │ ");
    const leftWidth = Math.max(50, Math.floor((width - visibleWidth(gutter)) / 2));
    const rightWidth = Math.max(48, width - leftWidth - visibleWidth(gutter));
    const left = fitProgressPane(progressLines, leftWidth, height, theme);
    const right = renderTranscriptPane(tui, theme, rightWidth, height);
    return Array.from(
      { length: height },
      (_unused, index) => padToWidth(left[index] ?? "", leftWidth) + gutter + fitLine(right[index] ?? "", rightWidth),
    );
  };

  const unsubscribe = ctx.ui.onTerminalInput((data) => {
    if (matchesKey(data, Key.ctrl("\\")) || matchesKey(data, Key.f2) || matchesKey(data, Key.alt("o"))) {
      toggleInspector();
      return { consume: true };
    }
    if (!open) return undefined;
    const count = snapshot?.agents.length ?? 0;
    if (matchesKey(data, Key.escape) || data === "q") {
      closeInspector();
      return { consume: true };
    }
    if (count === 0) return { consume: true };
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab) || data === "l") {
      selected = (selected + 1) % count;
      scroll = 0;
    } else if (matchesKey(data, Key.left) || data === "h") {
      selected = (selected - 1 + count) % count;
      scroll = 0;
    } else if (matchesKey(data, Key.up) || data === "k") {
      scroll = Math.min(maxScroll, scroll + 1);
    } else if (matchesKey(data, Key.down) || data === "j") {
      scroll = Math.max(0, scroll - 1);
    } else if (matchesKey(data, Key.pageUp)) {
      scroll = Math.min(maxScroll, scroll + viewport);
    } else if (matchesKey(data, Key.pageDown)) {
      scroll = Math.max(0, scroll - viewport);
    } else {
      return undefined;
    }
    requestRender?.();
    return { consume: true };
  });

  return {
    update(next) {
      snapshot = next;
      if (open) requestRender?.();
    },
    render: renderSplit,
    isOpen: () => open || Date.now() < suppressAbortUntil,
    dispose() {
      unsubscribe();
    },
  };
}

function renderAgentTranscript(messages: unknown[], tui: TUI, cwd: string, width: number): string[] {
  const markdownTheme = getMarkdownTheme();
  const items: { render: (width: number) => string[] }[] = [];
  const pendingTools = new Map<string, ToolExecutionComponent>();
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (message.role === "user") {
      const text = userMessageText(message.content);
      if (text) items.push(new UserMessageComponent(text, markdownTheme));
    } else if (message.role === "assistant") {
      items.push(
        new AssistantMessageComponent(
          message as unknown as ConstructorParameters<typeof AssistantMessageComponent>[0],
          false,
          markdownTheme,
          "thinking",
        ),
      );
      for (const block of asArray(message.content)) {
        if (isRecord(block) && block.type === "toolCall" && typeof block.name === "string" && typeof block.id === "string") {
          const tool = new ToolExecutionComponent(block.name, block.id, block.arguments, { showImages: false }, undefined, tui, cwd);
          tool.setExpanded(false);
          pendingTools.set(block.id, tool);
          items.push(tool);
        }
      }
    } else if (message.role === "toolResult") {
      const tool = typeof message.toolCallId === "string" ? pendingTools.get(message.toolCallId) : undefined;
      if (tool) tool.updateResult({ content: resultContent(message.content), isError: message.isError === true, details: message.details });
    }
  }
  return items.flatMap((item) => item.render(width));
}

function transcriptPaneHeight(termRows: number): number {
  const safeRows = termRows > 0 ? termRows : 32;
  return Math.max(10, Math.min(34, Math.floor(safeRows * 0.62)));
}

function fitProgressPane(lines: string[], width: number, height: number, theme: ProgressTheme): string[] {
  if (lines.length <= height) return fillPane(lines, width, height);
  const hidden = lines.length - height + 1;
  const footer = theme.fg("dim", fitLine(`  … ${String(hidden)} workflow lines hidden while transcript pane is open`, width));
  return fillPane([...lines.slice(0, height - 1), footer], width, height);
}

function fillPane(lines: string[], width: number, height: number): string[] {
  const fitted = lines.slice(0, height).map((line) => fitLine(line, width));
  while (fitted.length < height) fitted.push("");
  return fitted;
}

function fitLine(line: string, width: number): string {
  if (!line.includes("\u001B")) return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 3))}...`;
  return truncateToWidth(line, width, "...");
}

function padToWidth(line: string, width: number): string {
  const fitted = fitLine(line, width);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}

function userMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  return asArray(content)
    .filter((block): block is { text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function resultContent(content: unknown): { type: string; text?: string; data?: string; mimeType?: string }[] {
  return asArray(content).filter(isRecord) as { type: string; text?: string; data?: string; mimeType?: string }[];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emptySnapshot(): WorkflowSnapshot {
  return { workflowName: "", description: "", plannedPhases: [], phases: [], logs: [], traces: [], agents: [], fanOuts: [], messages: [] };
}

interface RunningWorkflowUiState {
  displayForWidth: (width: number, theme?: ProgressTheme) => ProgressDisplay;
  inspector: WorkflowInspector;
  requestRender?: () => void;
  statusLine?: string;
}

const runningWorkflowUiStates = new WeakMap<ExtensionCommandContext, RunningWorkflowUiState>();

function updateRunningWorkflowUi(
  ctx: ExtensionCommandContext,
  displayForWidth: (width: number, theme?: ProgressTheme) => ProgressDisplay,
  inspector: WorkflowInspector,
): void {
  const existing = runningWorkflowUiStates.get(ctx);
  if (existing) {
    existing.displayForWidth = displayForWidth;
    existing.inspector = inspector;
    updateRunningWorkflowStatus(ctx, existing);
    existing.requestRender?.();
    return;
  }

  const state: RunningWorkflowUiState = { displayForWidth, inspector };
  runningWorkflowUiStates.set(ctx, state);
  updateRunningWorkflowStatus(ctx, state);
  ctx.ui.setWidget(
    RUNNING_WORKFLOW_WIDGET,
    (tui, theme) => {
      state.requestRender = () => tui.requestRender();
      return {
        render: (width: number) => {
          const display = state.displayForWidth(width, theme);
          return state.inspector.render(tui, theme, width, display.widgetLines);
        },
        invalidate: () => updateRunningWorkflowStatus(ctx, state),
      };
    },
    { placement: "aboveEditor" },
  );
}

function updateRunningWorkflowStatus(ctx: ExtensionCommandContext, state: RunningWorkflowUiState): void {
  const statusLine = state.displayForWidth(96).statusLine;
  if (statusLine === state.statusLine) return;
  state.statusLine = statusLine;
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, statusLine);
}

function clearRunningWorkflowUi(ctx: ExtensionCommandContext): void {
  runningWorkflowUiStates.delete(ctx);
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, undefined);
  ctx.ui.setWidget(RUNNING_WORKFLOW_WIDGET, undefined);
}

function parseWorkflowCommandOptions(rawInput: string): { rawInput: string; saveLog: boolean } {
  const tokens = rawInput.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  let saveLog = false;
  const inputTokens: string[] = [];
  for (const token of tokens) {
    if (token === "--save-log") {
      saveLog = true;
      continue;
    }
    inputTokens.push(token);
  }
  return { rawInput: inputTokens.join(" "), saveLog };
}

function withWorkflowLogPath(message: string, logPath: string | undefined): string {
  return logPath ? `${message}\n\nSaved workflow log: ${logPath}` : message;
}

function workflowSessionLogMessage(sessionLogDir: string): string {
  return `Workflow session logs: ${sessionLogDir}`;
}

function sendUserMessageWhenReady(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
    return;
  }
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

function relativeToProject(cwd: string, target: string): string {
  return path.relative(cwd, target) || ".";
}

function sendWhenReady(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
  pi.sendMessage(
    {
      customType: MESSAGE_TYPE,
      content: message,
      display: true,
      details: { kind: "workflow-agent-prompt" },
    },
    ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" },
  );
}

function createReviewer(ctx: ExtensionContext): WorkflowReviewer {
  return async ({ draft }) => {
    if (ctx.mode !== "tui") return { action: "reject", reason: "Generated workflows require TUI review before save or run" };
    return reviewGeneratedWorkflow(ctx, draft);
  };
}

async function reviewGeneratedWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<WorkflowReviewDecision> {
  const outcome = await tuiReviewWorkflow(ctx, draft);
  return outcome === "fallback" ? terminalReviewWorkflow(ctx, draft) : outcome;
}

function tuiReviewWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<WorkflowReviewDecision | "fallback"> {
  const workflowDir = path.join(ctx.cwd, ".pi", "workflows", draft.name);
  const outline = parseWorkflowOutline(draft.source, { workflowDir });
  let height = 32;
  return ctx.ui.custom<WorkflowReviewDecision | "fallback">((tui, theme, _keybindings, done) => {
    const expanded = defaultExpanded(outline);
    const comments = new Map<string, ReviewComment>();
    let nodes = flattenReviewNodes(outline, expanded);
    let selectedIndex = 0;
    let generalComment = "";
    let editing: { kind: "node" | "general"; commentKey?: string } | undefined;
    let hint: string | undefined;

    const editor = new Editor(
      tui,
      {
        borderColor: (text) => theme.fg("borderMuted", text),
        selectList: {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", theme.bold(text)),
          description: (text) => theme.fg("dim", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("error", text),
        },
      },
      { paddingX: 0 },
    );
    const refresh = (): void => {
      nodes = flattenReviewNodes(outline, expanded);
      selectedIndex = Math.max(0, Math.min(selectedIndex, nodes.length - 1));
      tui.requestRender();
    };
    const stopEditing = (): void => {
      editing = undefined;
      editor.setText("");
    };
    editor.onSubmit = (value) => {
      const text = value.trim();
      if (!editing) return;
      if (editing.kind === "general") {
        generalComment = text;
      } else if (editing.commentKey) {
        const node = nodes.find((candidate) => candidate.commentKey === editing?.commentKey);
        if (text && node?.stageId) {
          comments.set(editing.commentKey, { stageId: node.stageId, ...(node.promptId ? { promptId: node.promptId } : {}), text });
        } else {
          comments.delete(editing.commentKey);
        }
      }
      stopEditing();
      tui.requestRender();
    };

    const startComment = (): void => {
      const node = nodes.at(selectedIndex);
      if (!node?.commentKey || !node.stageId) {
        hint = "Select a stage or prompt to add a note.";
        tui.requestRender();
        return;
      }
      editing = { kind: "node", commentKey: node.commentKey };
      editor.setText(comments.get(node.commentKey)?.text ?? "");
      hint = undefined;
      tui.requestRender();
    };

    return {
      render(width: number): string[] {
        height = tui.terminal.rows;
        return renderWorkflowReview(
          outline,
          {
            selectedIndex,
            expanded,
            comments,
            generalComment,
            ...(editing ? { editing: { kind: editing.kind, text: editor.getText() } } : {}),
            height,
            ...(hint ? { hint } : {}),
          },
          width,
          theme,
        );
      },
      handleInput(data: string): void {
        if (editing) {
          if (matchesKey(data, Key.escape)) {
            stopEditing();
            tui.requestRender();
            return;
          }
          editor.handleInput(data);
          tui.requestRender();
          return;
        }
        hint = undefined;
        if (matchesKey(data, Key.escape)) {
          done({ action: "reject", reason: "Workflow review canceled" });
        } else if (data === "a" || data === "A") {
          done({ action: "approve" });
        } else if (data === "r" || data === "R") {
          if (reviewHasFeedback(comments, generalComment)) {
            done({ action: "reject", reason: buildChangeRequest(outline, comments, generalComment) });
          } else {
            hint = "Add a note (c) or a general comment (g) before requesting changes.";
            tui.requestRender();
          }
        } else if (data === "t" || data === "T") {
          done("fallback");
        } else if (data === "c" || data === "C") {
          startComment();
        } else if (data === "g" || data === "G") {
          editing = { kind: "general" };
          editor.setText(generalComment);
          tui.requestRender();
        } else if (matchesKey(data, Key.up) || data === "k") {
          selectedIndex = Math.max(0, selectedIndex - 1);
          tui.requestRender();
        } else if (matchesKey(data, Key.down) || data === "j") {
          selectedIndex = Math.min(nodes.length - 1, selectedIndex + 1);
          tui.requestRender();
        } else if (matchesKey(data, Key.right) || data === "l") {
          expandNode(expanded, nodes[selectedIndex], true);
          refresh();
        } else if (matchesKey(data, Key.left) || data === "h") {
          expandNode(expanded, nodes[selectedIndex], false);
          refresh();
        } else if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
          toggleNode(expanded, nodes[selectedIndex]);
          refresh();
        }
      },
      invalidate(): void {
        tui.requestRender();
      },
    };
  });
}

function expandNode(expanded: Set<string>, node: ReviewNode | undefined, open: boolean): void {
  if (!node?.expandable) return;
  if (open) expanded.add(node.id);
  else expanded.delete(node.id);
}

function toggleNode(expanded: Set<string>, node: ReviewNode | undefined): void {
  if (!node?.expandable) return;
  if (expanded.has(node.id)) expanded.delete(node.id);
  else expanded.add(node.id);
}

async function terminalReviewWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<WorkflowReviewDecision> {
  return ctx.ui.custom<WorkflowReviewDecision>((tui, theme, _keybindings, done) => {
    let feedbackMode = false;
    const editor = new Editor(
      tui,
      {
        borderColor: (text) => theme.fg("borderMuted", text),
        selectList: {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", theme.bold(text)),
          description: (text) => theme.fg("dim", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("error", text),
        },
      },
      { paddingX: 0 },
    );
    editor.onSubmit = (value) => {
      const feedback = value.trim();
      if (!feedback) {
        feedbackMode = false;
        tui.requestRender();
        return;
      }
      done({ action: "reject", reason: `Reviewer feedback: ${feedback}` });
    };
    return {
      render(width: number): string[] {
        return approvalLines(draft, { feedbackMode, feedback: editor.getText() }).map((line) =>
          truncateToWidth(styleApprovalLine(line, theme), width),
        );
      },
      handleInput(data: string): void {
        if (feedbackMode) {
          if (matchesKey(data, Key.escape)) {
            feedbackMode = false;
            editor.setText("");
            tui.requestRender();
            return;
          }
          editor.handleInput(data);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.tab)) {
          feedbackMode = true;
          tui.requestRender();
          return;
        }
        if (data === "y" || data === "Y") done({ action: "approve" });
        if (data === "n" || data === "N" || matchesKey(data, Key.escape))
          done({ action: "reject", reason: "Generated workflow was rejected" });
      },
      invalidate(): void {
        tui.requestRender();
      },
    };
  });
}

function styleApprovalLine(line: string, theme: ProgressTheme): string {
  if (line.includes("Review generated workflow")) return theme.fg("accent", theme.bold(line));
  if (line.includes("Decision") || line.includes("approve")) return theme.fg("success", line);
  if (line.includes("Feedback") || line.includes("feedback")) return theme.fg("warning", line);
  if (line.includes("Intent") || line.includes("Plan") || line.includes("Runtime Surface") || line.includes("Source Preview"))
    return theme.bold(line);
  if (line.includes("Source:")) return theme.fg("muted", line);
  return line;
}

async function workflowSettingsCommand(ctx: ExtensionCommandContext, args: string): Promise<void> {
  const trimmed = args.trim();
  if (trimmed) {
    try {
      const settings = parseWorkflowSettingsArgs(trimmed);
      await writeProjectWorkflowSettings(ctx.cwd, settings);
      ctx.ui.notify(`Workflow max parallel agents set to ${String(settings.maxParallelAgents)} in .pi/settings.json`, "info");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }
  if (ctx.mode !== "tui") {
    const settings = await readProjectWorkflowSettings(ctx.cwd);
    ctx.ui.notify(
      `Workflow max parallel agents: ${String(settings.maxParallelAgents)}. Set with /workflow-settings maxParallelAgents=<n>.`,
      "info",
    );
    return;
  }
  await tuiWorkflowSettings(ctx);
}

function parseWorkflowSettingsArgs(args: string): WorkflowSettings {
  const match = /^(?:(?:maxParallelAgents|maxParallel)\s*=\s*)?(\d+)$/.exec(args);
  if (!match) throw new Error("Usage: /workflow-settings [maxParallelAgents=<positive integer>]");
  return { maxParallelAgents: Number(match[1]) };
}

async function tuiWorkflowSettings(ctx: ExtensionCommandContext): Promise<void> {
  const settings = await readProjectWorkflowSettings(ctx.cwd);
  await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
    const items: SettingItem[] = [
      {
        id: "maxParallelAgents",
        label: "Max parallel agents",
        currentValue: String(settings.maxParallelAgents),
        values: workflowMaxParallelChoices(settings.maxParallelAgents),
      },
    ];
    const container = new Container();
    container.addChild({
      render(width: number): string[] {
        return [
          truncateToWidth(theme.fg("accent", theme.bold("Workflow Settings")), width),
          truncateToWidth(theme.fg("muted", "Saved to .pi/settings.json. Extra parallel items queue until a slot opens."), width),
          "",
        ];
      },
      invalidate(): void {
        return undefined;
      },
    });
    const settingsList = new SettingsList(
      items,
      5,
      getSettingsListTheme(),
      (id, newValue) => {
        if (id !== "maxParallelAgents") return;
        const next = { maxParallelAgents: Number(newValue) };
        void writeProjectWorkflowSettings(ctx.cwd, next)
          .then(() => ctx.ui.notify(`Workflow max parallel agents set to ${String(next.maxParallelAgents)}`, "info"))
          .catch((error: unknown) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"));
      },
      () => done(undefined),
      { enableSearch: false },
    );
    container.addChild(settingsList);
    return {
      render: (width: number): string[] => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput(data: string): void {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

function workflowMaxParallelChoices(currentValue: number): string[] {
  const values = new Set([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, currentValue]);
  return [...values].sort((left, right) => left - right).map(String);
}

async function reviewWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  const name = normalizeWorkflowName(args.trim());
  const workflow = (await discoverWorkflows(ctx.cwd)).find((candidate) => candidate.name === name);
  if (!workflow) {
    ctx.ui.notify(`Workflow '${name}' not found.`, "warning");
    return;
  }
  pi.sendMessage({ customType: MESSAGE_TYPE, content: await readFile(workflow.entryFile, "utf8"), display: true, details: undefined });
}

function splitFirstWord(text: string): [string, string] {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return [match?.[1] ?? "", match?.[2] ?? ""];
}

async function workflowCompletions(cwd: string, prefix: string): Promise<{ value: string; label: string }[] | null> {
  const matches = (await discoverWorkflows(cwd)).map((workflow) => workflow.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
}
