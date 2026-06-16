import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { workflowNaturalLanguageRequestMessage } from "../src/workflow-command.ts";
import { discoverWorkflows, workflowRootsForProject } from "../src/workflow-discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { type GeneratedWorkflowDraft, type WorkflowReviewer } from "../src/workflow-request.ts";
import { createWorkflowRunLog, type WorkflowRunLog } from "../src/workflow-run-logs.ts";
import { normalizeWorkflowName, runWorkflowFromDirectory, type WorkflowSnapshot } from "../src/workflow-runtime.ts";
import { resolveWorkflowInput } from "../src/workflow-input.ts";
import { workflowFailureMessage, workflowCompleteMessage } from "../src/workflow-messages.ts";
import {
  initialWorkflowProgressLines,
  initialWorkflowProgressStatusLine,
  workflowProgressLines,
  workflowProgressStatusLine,
} from "../src/workflow-progress.ts";
import { workflowApprovalLines } from "../src/workflow-review.ts";
import { createWorkflowTools } from "../src/workflow-tools.ts";

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
  sendWhenReady(pi, ctx, workflowNaturalLanguageRequestMessage(trimmed, names));
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
  try {
    ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, "resolving input");
    const commandOptions = parseWorkflowCommandOptions(rawInput);
    const source = await readFile(workflow.entryFile, "utf8");
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd, reviewer });
    const input = await resolveWorkflowInput({
      rawInput: commandOptions.rawInput,
      workflowName,
      metadata: workflow.metadata,
      source,
      agent: createPiWorkflowAgent({ cwd: ctx.cwd, reviewer, tools: [] }),
    });
    if (commandOptions.saveLog) {
      runLog = await createWorkflowRunLog({
        cwd: ctx.cwd,
        workflowName,
        workflowDir: workflow.dir,
        metadata: workflow.metadata,
        source,
        input,
      });
      ctx.ui.notify(`Saving workflow log to ${relativeToProject(ctx.cwd, runLog.runDir)}`, "info");
    }
    ctx.ui.notify(`Running workflow '${workflowName}'`, "info");
    updateRunningWorkflowUi(ctx, initialWorkflowProgressStatusLine(), initialWorkflowProgressLines(workflowName));
    const result = await runWorkflowFromDirectory({
      cwd: ctx.cwd,
      workflowName,
      input,
      agent,
      workflowRoots: await workflowRootsForProject(ctx.cwd),
      signal: ctx.signal,
      onEvent: (event) => runLog?.recordEvent(event),
      onSnapshot: (snapshot) => {
        lastSnapshot = snapshot;
        updateRunningWorkflowUi(ctx, workflowProgressStatusLine(snapshot), workflowProgressLines(snapshot));
      },
    });
    await runLog?.complete(result.result, result.snapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: withWorkflowLogPath(workflowCompleteMessage(result.workflowName, result.result), logPath),
      display: true,
      details: { workflowName: result.workflowName, result: result.result, logPath },
    });
  } catch (error) {
    await runLog?.fail(error, lastSnapshot);
    const logPath = runLog ? relativeToProject(ctx.cwd, runLog.runDir) : undefined;
    const message = withWorkflowLogPath(workflowFailureMessage(workflowName, error), logPath);
    ctx.ui.notify(message, "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName, logPath } });
  } finally {
    clearRunningWorkflowUi(ctx);
  }
}

function updateRunningWorkflowUi(ctx: ExtensionCommandContext, statusLine: string, widgetLines: string[]): void {
  ctx.ui.setStatus(RUNNING_WORKFLOW_STATUS, statusLine);
  ctx.ui.setWidget(RUNNING_WORKFLOW_WIDGET, widgetLines, { placement: "aboveEditor" });
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
    return (await reviewGeneratedWorkflow(ctx, draft))
      ? { action: "approve" }
      : { action: "reject", reason: "Generated workflow was rejected" };
  };
}

async function reviewGeneratedWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => ({
    render(width: number): string[] {
      return workflowApprovalLines(draft).map((line) => {
        const styled = line.includes("Workflow approval")
          ? theme.fg("accent", theme.bold(line))
          : line.includes("Decision") || line.includes("approve")
            ? theme.fg("success", line)
            : line.includes("Review") || line.includes("Goal") || line.includes("Steps") || line.includes("What will run")
              ? theme.bold(line)
              : line;
        return truncateToWidth(styled, width);
      });
    },
    handleInput(data: string): void {
      if (data === "y" || data === "Y") done(true);
      if (data === "n" || data === "N" || matchesKey(data, Key.escape)) done(false);
    },
    invalidate(): void {
      tui.requestRender();
    },
  }));
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
