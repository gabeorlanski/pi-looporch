import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import type { BackgroundWorkflowRunResult } from "../src/background-runs.ts";
import { WorkflowInputError, parseWorkflowInput } from "../src/input.ts";
import { completeMessage, failureMessage } from "../src/display/messages.ts";
import { disposeRunningWorkflowUi, openRunningWorkflowInspector, restoreRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import { startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import { errorMessage } from "../src/errors.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { workflowLogReviewMessage } from "../src/log-review.ts";
import { workflowAgentSessionLogParentDirectory } from "../src/session-logs.ts";
import { readActiveWorkflowRuns } from "../src/workflow/active-runs.ts";
import { readActiveWorkflowTerminalResults } from "../src/workflow/active-run-snapshots.ts";
import { PROJECT_CONFIG_DIR } from "../src/workflow/config-dir.ts";
import { normalizeWorkflowName } from "../src/workflow/paths.ts";
import { resolveWorkflowInputContract } from "../src/workflow/start.ts";
import {
  readWorkflowSettings,
  writeGlobalWorkflowSettings,
  writeProjectWorkflowSettings,
  type WorkflowSettings,
  type WorkflowSettingsPatch,
} from "../src/workflow/settings.ts";

const MESSAGE_TYPE = "pi-workflow-message";

interface WorkflowRunOwner {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
}

interface WorkflowCompletionDelivery {
  kind: "complete";
  workflowName: string;
  outputsDir?: string;
  resultPath?: string;
  sessionLogDir: string;
}

interface WorkflowFailureDelivery {
  kind: "failure";
  workflowName: string;
  error: unknown;
}

type WorkflowTerminalDelivery = WorkflowCompletionDelivery | WorkflowFailureDelivery;

const workflowRunOwners = new Map<string, WorkflowRunOwner>();
const pendingWorkflowRunDeliveries = new Map<string, WorkflowTerminalDelivery>();
const deliveredWorkflowRunKeys = new Set<string>();

/** Registers pi-workflow commands, tools, and TUI hooks with a Pi extension host. */
export default function piWorkflow(pi: ExtensionAPI) {
  for (const tool of createWorkflowTools({
    agentForContext: (ctx) => createPiWorkflowAgent({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }),
  })) {
    pi.registerTool(tool);
  }

  pi.registerCommand("workflow", {
    description: "Run or create a project workflow in the current session",
    handler: async (args, ctx) => steerWorkflowCommand(pi, ctx, undefined, args),
  });

  pi.registerCommand("workflow-review", {
    description: "Review workflow session logs for token-cost reduction",
    handler: async (args, ctx) => reviewWorkflowCommand(pi, ctx, args),
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
    if (!ctx.isProjectTrusted()) return;
    await deliverReloadedTerminalWorkflowRuns(pi, ctx);
    await refreshWorkflowRunOwners(pi, ctx);
    await restoreRunningWorkflowUi(ctx);
    for (const workflow of await discoverWorkflows(ctx.cwd, true)) {
      const command = `workflow:${workflow.name}`;
      pi.registerCommand(command, {
        description: workflow.metadata.description,
        handler: async (args, commandCtx) => steerWorkflowCommand(pi, commandCtx, workflow.name, args),
      });
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    invalidateWorkflowRunOwners(ctx);
    disposeRunningWorkflowUi(ctx);
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

  if (!requireTrustedProject(ctx, "using project workflows")) return;

  const workflows = await discoverWorkflows(ctx.cwd, true);
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
  if (!requireTrustedProject(ctx, `running workflow '${workflowName}'`)) return;

  const abortControls = createWorkflowAbortControls(ctx);
  try {
    const { workflow, inputContract } = await resolveWorkflowInputContract({
      cwd: ctx.cwd,
      workflowName,
      projectTrusted: true,
    });
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
    const agent = createPiWorkflowAgent({ cwd: ctx.cwd, projectTrusted: true });
    ctx.ui.notify(`Running workflow '${workflowName}' in the background`, "info");
    const visible = await startVisibleWorkflowRun({
      ctx,
      cwd: ctx.cwd,
      workflowName,
      input: parsedInput.input,
      agentDir: getAgentDir(),
      projectTrusted: true,
      agent,
      signal: abortControls.signal,
      abortWorkflow: abortControls.abort,
    });
    const ownerKey = registerWorkflowRunOwner(pi, ctx, visible.prepared.runId);
    void settleBackgroundWorkflowRun(ownerKey, workflowName, visible.run.finished, () => {
      visible.cleanup();
      abortControls.dispose();
    });
  } catch (error) {
    abortControls.dispose();
    if (error instanceof Error && error.message === `Workflow '${workflowName}' not found.`) {
      ctx.ui.notify(error.message, "warning");
      return;
    }
    const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
  }
}

async function settleBackgroundWorkflowRun(
  ownerKey: string,
  workflowName: string,
  finished: Promise<BackgroundWorkflowRunResult>,
  cleanup: () => void,
): Promise<void> {
  try {
    const result = await finished;
    deliverWorkflowRunTerminal(ownerKey, completionDeliveryFromResult(result));
  } catch (error) {
    deliverWorkflowRunTerminal(ownerKey, { kind: "failure", workflowName, error });
  } finally {
    cleanup();
  }
}

function completeBackgroundWorkflow(pi: ExtensionAPI, result: WorkflowCompletionDelivery): void {
  const outputsMessage = result.resultPath
    ? `Workflow result: ${result.resultPath}`
    : `Workflow outputs: ${result.outputsDir ?? "not saved"}`;
  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content: `${completeMessage(result.workflowName)}\n\n${outputsMessage}\n\nWorkflow session logs: ${result.sessionLogDir}`,
    display: true,
    details: {
      workflowName: result.workflowName,
      outputsDir: result.outputsDir,
      resultPath: result.resultPath,
      sessionLogDir: result.sessionLogDir,
    },
  });
}

function failBackgroundWorkflow(pi: ExtensionAPI, ctx: ExtensionContext, workflowName: string, error: unknown): void {
  const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
  ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
  pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
}

function registerWorkflowRunOwner(pi: ExtensionAPI, ctx: ExtensionContext, runId: string): string {
  const key = workflowRunOwnerKey(ctx.cwd, ctx.sessionManager.getSessionId(), runId);
  workflowRunOwners.set(key, { pi, ctx });
  const pending = pendingWorkflowRunDeliveries.get(key);
  if (pending) deliverWorkflowRunTerminal(key, pending);
  return key;
}

async function refreshWorkflowRunOwners(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  flushPendingWorkflowRunDeliveries(pi, ctx);
  for (const record of await readActiveWorkflowRuns(ctx.cwd, ctx.sessionManager.getSessionId())) {
    registerWorkflowRunOwner(pi, ctx, record.runId);
  }
}

function flushPendingWorkflowRunDeliveries(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const keyPrefix = workflowRunOwnerKeyPrefix(ctx.cwd, ctx.sessionManager.getSessionId());
  for (const key of pendingWorkflowRunDeliveries.keys()) {
    if (!key.startsWith(keyPrefix)) continue;
    workflowRunOwners.set(key, { pi, ctx });
    const pending = pendingWorkflowRunDeliveries.get(key);
    if (pending) deliverWorkflowRunTerminal(key, pending);
  }
}

function invalidateWorkflowRunOwners(ctx: ExtensionContext): void {
  for (const [key, owner] of workflowRunOwners.entries()) {
    if (owner.ctx === ctx) workflowRunOwners.delete(key);
  }
}

async function deliverReloadedTerminalWorkflowRuns(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const terminals = await readActiveWorkflowTerminalResults(ctx.cwd, ctx.sessionManager.getSessionId());
  for (const terminal of terminals) {
    const ownerKey = registerWorkflowRunOwner(pi, ctx, terminal.runId);
    const sessionLogDir = workflowAgentSessionLogParentDirectory(ctx.cwd, terminal.runId);
    deliverWorkflowRunTerminal(
      ownerKey,
      terminal.status === "done"
        ? {
            kind: "complete",
            workflowName: terminal.workflowName,
            outputsDir: terminal.outputsDir,
            resultPath: terminal.resultPath,
            sessionLogDir,
          }
        : { kind: "failure", workflowName: terminal.workflowName, error: terminal.error ?? "Workflow failed" },
    );
  }
}

function deliverWorkflowRunTerminal(ownerKey: string, delivery: WorkflowTerminalDelivery): void {
  if (deliveredWorkflowRunKeys.has(ownerKey)) return;
  const owner = workflowRunOwners.get(ownerKey);
  if (!owner) {
    pendingWorkflowRunDeliveries.set(ownerKey, delivery);
    return;
  }
  deliveredWorkflowRunKeys.add(ownerKey);
  pendingWorkflowRunDeliveries.delete(ownerKey);
  workflowRunOwners.delete(ownerKey);
  try {
    if (delivery.kind === "complete") completeBackgroundWorkflow(owner.pi, delivery);
    else failBackgroundWorkflow(owner.pi, owner.ctx, delivery.workflowName, delivery.error);
  } catch (error) {
    owner.ctx.ui.notify(terminalDeliveryFailureMessage(delivery, error), "error");
  }
}

function terminalDeliveryFailureMessage(delivery: WorkflowTerminalDelivery, error: unknown): string {
  if (delivery.kind === "complete")
    return `Workflow '${delivery.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`;
  return `Workflow '${delivery.workflowName}' failed, but failure handling failed: ${errorMessage(error)}`;
}

function completionDeliveryFromResult(result: BackgroundWorkflowRunResult): WorkflowCompletionDelivery {
  return {
    kind: "complete",
    workflowName: result.workflowName,
    outputsDir: result.outputsDir,
    resultPath: result.resultPath,
    sessionLogDir: result.sessionLogDir,
  };
}

function workflowRunOwnerKey(cwd: string, sessionId: string, runId: string): string {
  return `${workflowRunOwnerKeyPrefix(cwd, sessionId)}${runId}`;
}

function workflowRunOwnerKeyPrefix(cwd: string, sessionId: string): string {
  return `${path.resolve(cwd)}\0${sessionId}\0`;
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
      customType: MESSAGE_TYPE,
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

function requireTrustedProject(ctx: ExtensionCommandContext, action: string): boolean {
  if (ctx.isProjectTrusted()) return true;
  ctx.ui.notify(`Trust this project before ${action}.`, "warning");
  return false;
}

async function workflowSettingsCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  const trimmed = args.trim();
  if (trimmed) {
    try {
      const { scope, settings } = parseWorkflowSettingsArgs(trimmed);
      if (scope === "global") {
        await writeGlobalWorkflowSettings(getAgentDir(), settings);
      } else {
        if (!requireTrustedProject(ctx, "writing project workflow settings")) return;
        await writeProjectWorkflowSettings(ctx.cwd, settings);
      }
      ctx.ui.notify(workflowSettingsSavedMessage(scope, settings), "info");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }
  const projectTrusted = ctx.isProjectTrusted();
  const settings = await readWorkflowSettings(ctx.cwd, getAgentDir(), projectTrusted);
  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content: workflowSettingsMessage(getAgentDir(), settings, projectTrusted),
    display: true,
    details: { kind: "workflow-settings", settings },
  });
}

function parseWorkflowSettingsArgs(args: string): { scope: "global" | "project"; settings: WorkflowSettingsPatch } {
  const { scope, body } = parseWorkflowSettingsScope(args);
  const assignment = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/.exec(body);
  const name = assignment ? assignment[1] : /^\d+$/.test(body) ? "maxParallelAgents" : "";
  const setting = workflowSettingCommands.find((candidate) => candidate.names.includes(name));
  if (!setting) throw new Error(workflowSettingsUsage());
  return { scope, settings: setting.parse(assignment ? assignment[2] : body) };
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
  const target = scope === "global" ? "global settings.json" : `${PROJECT_CONFIG_DIR}/settings.json`;
  const setting = workflowSettingCommands.find((candidate) => candidate.value(settings) !== undefined);
  return setting ? setting.savedMessage(settings, target) : `Workflow settings saved in ${target}`;
}

function workflowSettingsMessage(agentDir: string, settings: WorkflowSettings, projectTrusted: boolean): string {
  const globalSettings = `${agentDir}/settings.json`;
  return [
    "# Workflow Settings",
    "",
    `- Max parallel agents: ${String(settings.maxParallelAgents)}`,
    `- Child agent extensions: ${formatExtensionList(settings.childAgentExtensions)}`,
    "",
    projectTrusted
      ? "Settings are merged from project settings over global settings."
      : "Project settings are ignored until this project is trusted; showing global/default settings only.",
    "",
    `- Project: ${PROJECT_CONFIG_DIR}/settings.json`,
    `- Global: ${globalSettings}`,
    "",
    "Commands:",
    "",
    "```text",
    ...workflowSettingCommands.flatMap((setting) => setting.examples),
    "```",
  ].join("\n");
}

function formatExtensionList(extensions: string[]): string {
  return extensions.length ? extensions.join(", ") : "none";
}

interface WorkflowSettingCommand {
  names: string[];
  examples: string[];
  parse: (value: string) => WorkflowSettingsPatch;
  value: (settings: WorkflowSettingsPatch) => unknown;
  savedMessage: (settings: WorkflowSettingsPatch, target: string) => string;
}

const workflowSettingCommands: WorkflowSettingCommand[] = [
  {
    names: ["maxParallelAgents", "maxParallel"],
    examples: ["/workflow-settings maxParallelAgents=8", "/workflow-settings --global maxParallelAgents=4"],
    parse: (value) => ({ maxParallelAgents: Number(value) }),
    value: (settings) => settings.maxParallelAgents,
    savedMessage: (settings, target) => `Workflow max parallel agents set to ${String(settings.maxParallelAgents)} in ${target}`,
  },
  {
    names: ["childAgentExtensions", "childExtensions", "extensions"],
    examples: [
      "/workflow-settings childAgentExtensions=pi-subagents,./extensions/todo.ts",
      "/workflow-settings --global childAgentExtensions=",
    ],
    parse: (value) => ({ childAgentExtensions: parseExtensionList(value) }),
    value: (settings) => settings.childAgentExtensions,
    savedMessage: (settings, target) =>
      `Workflow child agent extensions set to ${formatExtensionList(settings.childAgentExtensions ?? [])} in ${target}`,
  },
];

function workflowSettingsUsage(): string {
  return "Usage: /workflow-settings [--global] maxParallelAgents=<positive integer> | childAgentExtensions=<extension>[,<extension>...]";
}

async function reviewWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  try {
    if (!requireTrustedProject(ctx, "reviewing workflow session logs")) return;
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
