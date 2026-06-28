import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Editor,
  Key,
  SettingsList,
  isKeyRelease,
  isKeyRepeat,
  matchesKey,
  truncateToWidth,
  type SettingItem,
} from "@earendil-works/pi-tui";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows, workflowRootsForProject } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { type GeneratedWorkflowDraft, type WorkflowReviewer, type WorkflowReviewDecision } from "../src/request.ts";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRunResult } from "../src/background-runs.ts";
import { createWorkflowRunId, createWorkflowRunLog, type WorkflowRunLog } from "../src/run-logs.ts";
import { normalizeWorkflowName, type WorkflowSnapshot } from "../src/runtime.ts";
import { WorkflowInputError, extractWorkflowInputContract, parseWorkflowInput, validateWorkflowInput } from "../src/input.ts";
import { completeMessage, failureMessage, workflowStringHandoffMessage } from "../src/display/messages.ts";
import { initialProgressDisplay, progressDisplay, type ProgressTheme } from "../src/display/progress.ts";
import { createWorkflowInspector, type WorkflowInspector } from "../src/display/workflow-inspector-controller.ts";
import { beginDynamicWorkflow, clearRunningWorkflowUi, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
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
import { workflowLogReviewMessage } from "../src/log-review.ts";
import {
  readWorkflowSettings,
  writeGlobalWorkflowSettings,
  writeProjectWorkflowSettings,
  type WorkflowSettings,
  type WorkflowSettingsPatch,
} from "../src/workflow-settings.ts";

const MESSAGE_TYPE = "pi-workflow-message";

/** Registers pi-workflow commands, tools, and TUI hooks with a Pi extension host. */
export default function piWorkflow(pi: ExtensionAPI) {
  const aliases = new Set<string>();

  for (const tool of createWorkflowTools({
    agentForContext: (ctx) => createPiWorkflowAgent({ cwd: ctx.cwd }),
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
    description: "Review workflow session logs for token-cost reduction",
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
  const workflow = (await discoverWorkflows(ctx.cwd)).find((candidate) => candidate.name === workflowName);
  if (!workflow) {
    ctx.ui.notify(`Workflow '${workflowName}' not found.`, "warning");
    return;
  }
  let runLog: WorkflowRunLog | undefined;
  let lastSnapshot: WorkflowSnapshot | undefined;
  const inspectorRef: { current?: WorkflowInspector } = {};
  const abortControls = createWorkflowAbortControls(ctx, () => inspectorRef.current?.isOpen() ?? false);
  const inspector = createWorkflowInspector(ctx, {
    stop: () => {
      abortControls.abort();
      ctx.abort();
      ctx.ui.notify("Stopping workflow run", "warning");
    },
    pause: () => ctx.ui.notify("Workflow pause is cooperative and not available for active child agents yet.", "warning"),
    save: () => ctx.ui.notify("Workflow outputs are saved automatically in the temp outputs directory.", "info"),
  });
  inspectorRef.current = inspector;
  const activeWorkflow = beginDynamicWorkflow(ctx);
  try {
    const commandOptions = parseWorkflowCommandOptions(rawInput);
    const source = await readFile(workflow.entryFile, "utf8");
    const inputContract = extractWorkflowInputContract(source);
    const parsedInput = parseWorkflowInput(commandOptions.rawInput);
    if (parsedInput.action === "resolve") {
      activeWorkflow.done();
      inspector.dispose();
      abortControls.dispose();
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
    const workflowSettings = await readWorkflowSettings(ctx.cwd, getAgentDir());
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd });
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
    ctx.ui.notify(`Running workflow '${workflowName}' in the background`, "info");
    updateRunningWorkflowUi(ctx, (width, theme) => initialProgressDisplay(workflowName, width, theme, input), inspector);
    const run = await startBackgroundWorkflowRun({
      runId: parentRunId,
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
    void settleBackgroundWorkflowRun(
      pi,
      ctx,
      workflowName,
      run.finished,
      runLog,
      () => lastSnapshot,
      () => {
        activeWorkflow.done();
        inspector.dispose();
        abortControls.dispose();
        clearRunningWorkflowUi(ctx);
      },
    );
  } catch (error) {
    activeWorkflow.done();
    inspector.dispose();
    abortControls.dispose();
    await runLog?.fail(error, lastSnapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    const message = withWorkflowLogPath(error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error), logPath);
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName, logPath } });
  }
}

async function settleBackgroundWorkflowRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflowName: string,
  finished: Promise<BackgroundWorkflowRunResult>,
  runLog: WorkflowRunLog | undefined,
  lastSnapshot: () => WorkflowSnapshot | undefined,
  cleanup: () => void,
): Promise<void> {
  try {
    const result = await finished;
    try {
      await completeBackgroundWorkflow(pi, ctx, result, runLog);
    } catch (error) {
      ctx.ui.notify(`Workflow '${result.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`, "error");
    }
  } catch (error) {
    await failBackgroundWorkflow(pi, ctx, workflowName, error, runLog, lastSnapshot());
  } finally {
    cleanup();
  }
}

async function completeBackgroundWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  result: BackgroundWorkflowRunResult,
  runLog: WorkflowRunLog | undefined,
): Promise<void> {
  await runLog?.complete(result.result, result.snapshot);
  const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
  const sessionLogMessage = workflowSessionLogMessage(result.sessionLogDir);
  const outputsMessage = workflowOutputsMessage(result);
  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content: `${withWorkflowLogPath(completeMessage(result.workflowName, result.result), logPath)}\n\n${outputsMessage}\n\n${sessionLogMessage}`,
    display: true,
    details: {
      workflowName: result.workflowName,
      result: result.result,
      snapshot: result.snapshot,
      logPath,
      outputsDir: result.outputsDir,
      resultPath: result.resultPath,
      sessionLogDir: result.sessionLogDir,
    },
  });
  if (typeof result.result === "string") sendWorkflowStringHandoff(pi, ctx, result.workflowName, result.result);
}

async function failBackgroundWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflowName: string,
  error: unknown,
  runLog: WorkflowRunLog | undefined,
  lastSnapshot: WorkflowSnapshot | undefined,
): Promise<void> {
  await runLog?.fail(error, lastSnapshot);
  const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
  const message = withWorkflowLogPath(error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error), logPath);
  ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
  pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName, logPath } });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workflowOutputsMessage(result: BackgroundWorkflowRunResult): string {
  if (result.resultPath) return `Workflow result: ${result.resultPath}`;
  if (result.outputsDir) return `Workflow outputs: ${result.outputsDir}`;
  return "Workflow outputs: not saved";
}

function createWorkflowAbortControls(
  ctx: ExtensionCommandContext,
  shouldIgnoreEscape: () => boolean = () => false,
): { signal: AbortSignal; abort: () => void; dispose: () => void } {
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
    if (isRepeatedOrReleasedKey(data) || !matchesKey(data, Key.escape) || shouldIgnoreEscape()) return undefined;
    abortWorkflow();
    ctx.abort();
    ctx.ui.notify("Aborting workflow run", "warning");
    return { consume: true };
  });
  return {
    signal: controller.signal,
    abort: abortWorkflow,
    dispose() {
      unsubscribeInput();
      removeHostAbortListener();
    },
  };
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

function sendWorkflowStringHandoff(pi: ExtensionAPI, ctx: ExtensionCommandContext, workflowName: string, handoff: string): void {
  pi.sendMessage(
    {
      customType: MESSAGE_TYPE,
      content: workflowStringHandoffMessage(workflowName, handoff),
      display: false,
      details: { kind: "workflow-string-handoff", workflowName },
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
  const workflowDir = draft.sourceDirectory ?? path.join(ctx.cwd, ".pi", "workflows", draft.name);
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
          {
            summary: draft.proposal.summary,
            steps: draft.proposal.steps,
            willRun: draft.proposal.willRun,
            filePaths: draft.filePaths,
          },
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
        } else if (!isRepeatedOrReleasedKey(data) && matchesKey(data, Key.ctrl("o"))) {
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

function isRepeatedOrReleasedKey(data: string): boolean {
  return isKeyRepeat(data) || isKeyRelease(data);
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
      const { scope, settings } = parseWorkflowSettingsArgs(trimmed);
      if (scope === "global") {
        await writeGlobalWorkflowSettings(getAgentDir(), settings);
      } else {
        await writeProjectWorkflowSettings(ctx.cwd, settings);
      }
      ctx.ui.notify(workflowSettingsSavedMessage(scope, settings), "info");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }
  if (ctx.mode !== "tui") {
    const settings = await readWorkflowSettings(ctx.cwd, getAgentDir());
    ctx.ui.notify(workflowSettingsSummary(settings), "info");
    return;
  }
  await tuiWorkflowSettings(ctx);
}

function parseWorkflowSettingsArgs(args: string): { scope: "global" | "project"; settings: WorkflowSettingsPatch } {
  const { scope, body } = parseWorkflowSettingsScope(args);
  const maxParallelMatch = /^(?:(?:maxParallelAgents|maxParallel)\s*=\s*)?(\d+)$/.exec(body);
  if (maxParallelMatch) return { scope, settings: { maxParallelAgents: Number(maxParallelMatch[1]) } };
  const extensionsMatch = /^(?:childAgentExtensions|childExtensions|extensions)\s*=\s*(.*)$/.exec(body);
  if (extensionsMatch) return { scope, settings: { childAgentExtensions: parseExtensionList(extensionsMatch[1]) } };
  throw new Error(
    "Usage: /workflow-settings [--global] maxParallelAgents=<positive integer> | childAgentExtensions=<extension>[,<extension>...]",
  );
}

function parseWorkflowSettingsScope(args: string): { scope: "global" | "project"; body: string } {
  const trimmed = args.trim();
  if (trimmed.startsWith("--global ")) return { scope: "global", body: trimmed.slice("--global ".length).trim() };
  if (trimmed.startsWith("global ")) return { scope: "global", body: trimmed.slice("global ".length).trim() };
  if (trimmed.startsWith("scope=global ")) return { scope: "global", body: trimmed.slice("scope=global ".length).trim() };
  return { scope: "project", body: trimmed };
}

function parseExtensionList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((entry) => entry.trim());
}

function workflowSettingsSavedMessage(scope: "global" | "project", settings: WorkflowSettingsPatch): string {
  const target = scope === "global" ? "global settings.json" : ".pi/settings.json";
  if (settings.maxParallelAgents !== undefined) {
    return `Workflow max parallel agents set to ${String(settings.maxParallelAgents)} in ${target}`;
  }
  return `Workflow child agent extensions set to ${formatExtensionList(settings.childAgentExtensions ?? [])} in ${target}`;
}

function workflowSettingsSummary(settings: WorkflowSettings): string {
  return `Workflow max parallel agents: ${String(settings.maxParallelAgents)}. Child agent extensions: ${formatExtensionList(
    settings.childAgentExtensions,
  )}. Set with /workflow-settings maxParallelAgents=<n> or childAgentExtensions=<extension>[,<extension>...]. Use --global to write global settings.`;
}

function formatExtensionList(extensions: string[]): string {
  return extensions.length ? extensions.join(", ") : "none";
}

async function tuiWorkflowSettings(ctx: ExtensionCommandContext): Promise<void> {
  const settings = await readWorkflowSettings(ctx.cwd, getAgentDir());
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
          truncateToWidth(theme.fg("muted", `Child agent extensions: ${formatExtensionList(settings.childAgentExtensions)}`), width),
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
  try {
    ctx.ui.notify("Reviewing workflow session logs for token-cost reduction", "info");
    const content = await workflowLogReviewMessage({ cwd: ctx.cwd, target: args.trim() });
    pi.sendMessage({ customType: MESSAGE_TYPE, content, display: true, details: { kind: "workflow-log-review" } });
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

function splitFirstWord(text: string): [string, string] {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return [match?.[1] ?? "", match?.[2] ?? ""];
}

async function workflowCompletions(cwd: string, prefix: string): Promise<{ value: string; label: string }[] | null> {
  const matches = (await discoverWorkflows(cwd)).map((workflow) => workflow.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
}
