import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { naturalLanguageRequestMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows, workflowRootsForProject } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { type GeneratedWorkflowDraft, type WorkflowReviewer, type WorkflowReviewDecision } from "../src/request.ts";
import { createWorkflowRunId, createWorkflowRunLog, type WorkflowRunLog } from "../src/run-logs.ts";
import {
  normalizeWorkflowName,
  runWorkflowFromDirectory,
  type WorkflowAgentProgress,
  type WorkflowAgentSnapshot,
  type WorkflowSnapshot,
} from "../src/runtime.ts";
import { resolveWorkflowInput } from "../src/input.ts";
import { failureMessage, completeMessage } from "../src/display/messages.ts";
import { initialProgressDisplay, progressDisplay, type ProgressDisplay, type ProgressTheme } from "../src/display/progress.ts";
import { approvalLines } from "../src/display/approval.ts";
import { createWorkflowTools } from "../src/tools.ts";

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
  const abortControls = createWorkflowAbortControls(ctx);
  try {
    ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, "resolving input");
    const commandOptions = parseWorkflowCommandOptions(rawInput);
    const source = await readFile(workflow.entryFile, "utf8");
    const parentRunId = createWorkflowRunId(workflowName);
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd, reviewer });
    const reportInputResolutionProgress = createInputResolutionProgressUi(ctx, workflowName);
    const input = await resolveWorkflowInput({
      rawInput: commandOptions.rawInput,
      workflowName,
      metadata: workflow.metadata,
      source,
      agent: createPiWorkflowAgent({ cwd: ctx.cwd, reviewer, tools: [] }),
      signal: abortControls.signal,
      sessionLog: {
        parentId: parentRunId,
        agentId: 0,
        agentKey: "agent-000-input-resolution",
        workflowName,
        label: `resolve ${workflowName} input`,
        phaseIndex: 0,
      },
      onProgress: reportInputResolutionProgress,
    });
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
    updateRunningWorkflowUi(ctx, (width, theme) => initialProgressDisplay(workflowName, width, theme));
    const result = await runWorkflowFromDirectory({
      cwd: ctx.cwd,
      workflowName,
      input,
      agent,
      workflowRoots: await workflowRootsForProject(ctx.cwd),
      agentLogParentId: parentRunId,
      signal: abortControls.signal,
      onEvent: (event) => runLog?.recordEvent(event),
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot;
        updateRunningWorkflowUi(ctx, (width, theme) => progressDisplay(snapshot, width, theme));
      },
    });
    await runLog?.complete(result.result, result.snapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: withWorkflowLogPath(completeMessage(result.workflowName, result.result), logPath),
      display: true,
      details: { workflowName: result.workflowName, result: result.result, logPath },
    });
  } catch (error) {
    await runLog?.fail(error, lastSnapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    const message = withWorkflowLogPath(failureMessage(workflowName, error), logPath);
    ctx.ui.notify(message, "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName, logPath } });
  } finally {
    abortControls.dispose();
    clearRunningWorkflowUi(ctx);
  }
}

function createWorkflowAbortControls(ctx: ExtensionCommandContext): { signal: AbortSignal; dispose: () => void } {
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
    if (!matchesKey(data, Key.escape)) return undefined;
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

function updateRunningWorkflowUi(
  ctx: ExtensionCommandContext,
  displayForWidth: (width: number, theme?: ProgressTheme) => ProgressDisplay,
): void {
  const statusLine = displayForWidth(96).statusLine;
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, statusLine);
  ctx.ui.setWidget(
    RUNNING_WORKFLOW_WIDGET,
    (_tui, theme) => ({
      render: (width: number) => displayForWidth(width, theme).widgetLines,
      invalidate: () => {
        ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, displayForWidth(96).statusLine);
      },
    }),
    { placement: "aboveEditor" },
  );
}

function createInputResolutionProgressUi(ctx: ExtensionCommandContext, workflowName: string): (progress: WorkflowAgentProgress) => void {
  const agent: WorkflowAgentSnapshot = {
    id: 1,
    label: `resolve ${workflowName} input`,
    phaseIndex: 0,
    status: "running",
    startedAt: Date.now(),
    tokenCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    toolCallCount: 0,
    message: "starting",
  };
  const snapshot: WorkflowSnapshot = {
    workflowName: `${workflowName} input`,
    description: "Resolve workflow input",
    phases: [],
    logs: [],
    agents: [agent],
    fanOuts: [],
  };
  updateRunningWorkflowUi(ctx, (width, theme) => progressDisplay(snapshot, width, theme));
  return (progress) => {
    applyAgentProgress(agent, progress);
    updateRunningWorkflowUi(ctx, (width, theme) => progressDisplay(snapshot, width, theme));
  };
}

function applyAgentProgress(agent: WorkflowAgentSnapshot, progress: WorkflowAgentProgress): void {
  agent.message = progress.statusMessage;
  const reportsStructuredTokens = progress.inputTokenCount !== undefined || progress.outputTokenCount !== undefined;
  if (progress.inputTokenCount !== undefined) agent.inputTokenCount = progress.inputTokenCount;
  if (progress.outputTokenCount !== undefined) agent.outputTokenCount = progress.outputTokenCount;
  if (progress.toolCallCount !== undefined) agent.toolCallCount = progress.toolCallCount;
  if (progress.tokenCount === undefined) {
    agent.tokenCount = agent.inputTokenCount + agent.outputTokenCount;
    return;
  }
  agent.tokenCount = progress.tokenCount;
  if (!reportsStructuredTokens) agent.outputTokenCount = progress.tokenCount;
  if (reportsStructuredTokens && progress.outputTokenCount === undefined)
    agent.outputTokenCount = Math.max(0, progress.tokenCount - agent.inputTokenCount);
}

function clearRunningWorkflowUi(ctx: ExtensionCommandContext): void {
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

function relativeToProject(cwd: string, target: string): string {
  return path.relative(cwd, target) || ".";
}

function sendWhenReady(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
    return;
  }
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

function createReviewer(ctx: ExtensionContext): WorkflowReviewer {
  return async ({ draft }) => {
    if (ctx.mode !== "tui") return { action: "reject", reason: "Generated workflows require TUI review before save or run" };
    return reviewGeneratedWorkflow(ctx, draft);
  };
}

async function reviewGeneratedWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<WorkflowReviewDecision> {
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
