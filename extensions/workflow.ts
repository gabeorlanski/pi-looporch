import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage } from "../src/prompt-templates.ts";
import { discoverWorkflows, workflowRootsForProject } from "../src/discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRunResult } from "../src/background-runs.ts";
import { WorkflowInputError, extractWorkflowInputContract, parseWorkflowInput, validateWorkflowInput } from "../src/input.ts";
import { completeMessage, failureMessage } from "../src/display/messages.ts";
import { initialProgressDisplay, progressDisplay } from "../src/display/progress.ts";
import { beginDynamicWorkflow, clearRunningWorkflowUi, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import { errorMessage } from "../src/errors.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { workflowLogReviewMessage } from "../src/log-review.ts";
import { createWorkflowRunId } from "../src/workflow/run-id.ts";
import { normalizeWorkflowName } from "../src/workflow/paths.ts";
import {
  readWorkflowSettings,
  writeGlobalWorkflowSettings,
  writeProjectWorkflowSettings,
  type WorkflowSettings,
  type WorkflowSettingsPatch,
} from "../src/workflow/settings.ts";

const MESSAGE_TYPE = "pi-workflow-message";

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

  pi.registerCommand("workflow-settings", {
    description: "Configure project workflow settings",
    handler: async (args, ctx) => workflowSettingsCommand(pi, ctx, args),
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
  const abortControls = createWorkflowAbortControls(ctx);
  const activeWorkflow = beginDynamicWorkflow(ctx);
  try {
    const source = await readFile(workflow.entryFile, "utf8");
    const inputContract = extractWorkflowInputContract(source);
    const parsedInput = parseWorkflowInput(rawInput);
    if (parsedInput.action === "resolve") {
      activeWorkflow.done();
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
    ctx.ui.notify(`Running workflow '${workflowName}' in the background`, "info");
    updateRunningWorkflowUi(ctx, (width, theme) => initialProgressDisplay(workflowName, width, theme, input));
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
      onSnapshot: (snapshot) => {
        updateRunningWorkflowUi(ctx, (width, theme) => progressDisplay(snapshot, width, theme));
      },
    });
    void settleBackgroundWorkflowRun(pi, ctx, workflowName, run.finished, () => {
      activeWorkflow.done();
      abortControls.dispose();
      clearRunningWorkflowUi(ctx);
    });
  } catch (error) {
    activeWorkflow.done();
    abortControls.dispose();
    const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
  }
}

async function settleBackgroundWorkflowRun(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  workflowName: string,
  finished: Promise<BackgroundWorkflowRunResult>,
  cleanup: () => void,
): Promise<void> {
  try {
    const result = await finished;
    try {
      completeBackgroundWorkflow(pi, ctx, result);
    } catch (error) {
      ctx.ui.notify(`Workflow '${result.workflowName}' completed, but completion handling failed: ${errorMessage(error)}`, "error");
    }
  } catch (error) {
    failBackgroundWorkflow(pi, ctx, workflowName, error);
  } finally {
    cleanup();
  }
}

function completeBackgroundWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, result: BackgroundWorkflowRunResult): void {
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

function failBackgroundWorkflow(pi: ExtensionAPI, ctx: ExtensionCommandContext, workflowName: string, error: unknown): void {
  const message = error instanceof WorkflowInputError ? error.message : failureMessage(workflowName, error);
  ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
  pi.sendMessage({ customType: MESSAGE_TYPE, content: message, display: true, details: { workflowName } });
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
  return {
    signal: controller.signal,
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

async function workflowSettingsCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
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
  const settings = await readWorkflowSettings(ctx.cwd, getAgentDir());
  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content: workflowSettingsMessage(getAgentDir(), settings),
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
  const target = scope === "global" ? "global settings.json" : ".pi/settings.json";
  const setting = workflowSettingCommands.find((candidate) => candidate.value(settings) !== undefined);
  return setting ? setting.savedMessage(settings, target) : `Workflow settings saved in ${target}`;
}

function workflowSettingsMessage(agentDir: string, settings: WorkflowSettings): string {
  const globalSettings = path.join(agentDir, "settings.json");
  return [
    "# Workflow Settings",
    "",
    `- Max parallel agents: ${String(settings.maxParallelAgents)}`,
    `- Child agent extensions: ${formatExtensionList(settings.childAgentExtensions)}`,
    "",
    "Settings are merged from project settings over global settings.",
    "",
    "- Project: .pi/settings.json",
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
