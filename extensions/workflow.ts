import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import type { BackgroundWorkflowRunResult } from "../src/workflow/background-runs.ts";
import { parseWorkflowInput } from "../src/input.ts";
import { workflowCompletionMessage, workflowCompletionReviewPrompt } from "../src/display/workflow-completion.ts";
import { failureMessage } from "../src/display/messages.ts";
import { startWorkflowMonitorWidget, stopWorkflowMonitorWidget } from "../src/display/workflow-monitor-widget.ts";
import { openRunningWorkflowInspector, restoreRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import { abortVisibleWorkflowRuns, startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import { errorMessage } from "../src/errors.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { WorkflowInputError } from "../src/workflow/input-contract.ts";
import { normalizeWorkflowName } from "../src/workflow/paths.ts";
import { readWorkflowInputContract } from "../src/workflow/start.ts";
import { reviewWorkflowCommand } from "./commands/review.ts";
import { workflowSettingsCommand } from "./commands/settings.ts";
import { workflowStatusCommand } from "./commands/status.ts";
import { WORKFLOW_MESSAGE_TYPE } from "./messages.ts";

/** Registers pi-workflow commands, tools, and TUI hooks with a Pi extension host. */
export default function piWorkflow(pi: ExtensionAPI) {
  const aliases = new Set<string>();

  for (const tool of createWorkflowTools({
    agentForContext: (ctx) => createPiWorkflowAgent({ cwd: ctx.cwd }),
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

  pi.registerCommand("workflow-status", {
    description: "Show active workflow status for this project",
    handler: async (args, ctx) => workflowStatusCommand(pi, ctx, args),
  });

  pi.registerCommand("view-workflow", {
    description: "Open the running workflow inspector",
    handler: async (_args, ctx) => viewWorkflowCommand(ctx),
  });

  pi.registerCommand("workflow-settings", {
    description: "Configure project workflow settings",
    handler: async (args, ctx) => workflowSettingsCommand(pi, ctx, args),
  });

  pi.on("session_start", async (_event, ctx) => {
    await restoreRunningWorkflowUi(ctx);
    startWorkflowMonitorWidget(ctx);
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

  pi.on("session_shutdown", async (_event, ctx) => {
    stopWorkflowMonitorWidget(ctx);
    await abortVisibleWorkflowRuns(ctx);
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
  const abortControls = createWorkflowAbortControls(ctx);
  try {
    const inputContract = await readWorkflowInputContract(workflow);
    const parsedInput = parseWorkflowInput(rawInput);
    if (parsedInput.action === "resolve") {
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
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd });
    ctx.ui.notify(`Running workflow '${workflowName}' in the background`, "info");
    const visible = await startVisibleWorkflowRun({
      ctx,
      cwd: ctx.cwd,
      workflowName,
      input: parsedInput.input,
      agentDir: getAgentDir(),
      agent,
      signal: abortControls.signal,
      abortWorkflow: abortControls.abort,
    });
    void settleBackgroundWorkflowRun(
      pi,
      ctx,
      workflowName,
      visible.run.finished,
      () => {
        visible.cleanup();
        abortControls.dispose();
      },
      visible.isSessionClosing,
    );
  } catch (error) {
    abortControls.dispose();
    const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    pi.sendMessage({ customType: WORKFLOW_MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
  }
}

async function settleBackgroundWorkflowRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflowName: string,
  finished: Promise<BackgroundWorkflowRunResult>,
  cleanup: () => void,
  isSessionClosing: () => boolean,
): Promise<void> {
  try {
    const result = await finished;
    if (isSessionClosing()) return;
    try {
      completeBackgroundWorkflow(pi, ctx, result);
    } catch (error) {
      if (isSessionClosing()) return;
      ctx.ui.notify(`Workflow '${result.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`, "error");
    }
  } catch (error) {
    if (isSessionClosing()) return;
    failBackgroundWorkflow(pi, ctx, workflowName, error);
  } finally {
    cleanup();
  }
}

function completeBackgroundWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, result: BackgroundWorkflowRunResult): void {
  const details = {
    workflowName: result.workflowName,
    outputsDir: result.outputsDir,
    resultPath: result.resultPath,
    sessionLogDir: result.sessionLogDir,
  };
  pi.sendMessage({
    customType: WORKFLOW_MESSAGE_TYPE,
    content: workflowCompletionMessage(result),
    display: true,
    details,
  });
  pi.sendMessage(
    {
      customType: WORKFLOW_MESSAGE_TYPE,
      content: workflowCompletionReviewPrompt(result),
      display: true,
      details: {
        kind: "workflow-completion-handoff",
        ...details,
      },
    },
    ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" },
  );
}

function failBackgroundWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, workflowName: string, error: unknown): void {
  const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
  ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
  pi.sendMessage({ customType: WORKFLOW_MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
}

function createWorkflowAbortControls(ctx: ExtensionCommandContext): { signal: AbortSignal; abort: () => void; dispose: () => void } {
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
  return {
    signal: controller.signal,
    abort: abortWorkflow,
    dispose() {
      removeHostAbortListener();
    },
  };
}

function sendWhenReady(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
  pi.sendMessage(
    {
      customType: WORKFLOW_MESSAGE_TYPE,
      content: message,
      display: true,
      details: { kind: "workflow-agent-prompt" },
    },
    ctx.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" },
  );
}

async function viewWorkflowCommand(ctx: ExtensionCommandContext): Promise<void> {
  const opened = await openRunningWorkflowInspector(ctx);
  if (!opened) ctx.ui.notify("No running workflows to view.", "warning");
}

function splitFirstWord(text: string): [string, string] {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  return [match?.[1] ?? "", match?.[2] ?? ""];
}

async function workflowCompletions(cwd: string, prefix: string): Promise<{ value: string; label: string }[] | null> {
  const matches = (await discoverWorkflows(cwd)).map((workflow) => workflow.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
}
