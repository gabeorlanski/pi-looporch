/** Provides workflow behavior. */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../src/errors.ts";
import { naturalLanguageRequestMessage, steerableInputResolutionMessage, workflowFailureHandoffPrompt } from "../src/prompt-templates.ts";
import { discoverWorkflows } from "../src/discovery.ts";
import { createPiWorkflowAgent, type PiWorkflowAgentOptions } from "../src/pi-agent.ts";
import { createPiWorkflowLLM } from "../src/pi-llm.ts";
import { createParentAgentCapabilityCatalogProvider, type AgentCapabilityCatalogProvider } from "../src/pi-agent-capabilities.ts";
import { parseWorkflowInput } from "../src/input.ts";
import { startWorkflowMonitorWidget, stopWorkflowMonitorWidget } from "../src/display/workflow-monitor-widget.ts";
import { openRunningWorkflowInspector, restoreRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import { abortVisibleWorkflowRuns, startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import { sendWorkflowUserMessage } from "../src/display/workflow-user-message.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { WorkflowInputError } from "../src/workflow/input-contract.ts";
import type { WorkflowAgent, WorkflowLLM } from "../src/runtime/types.ts";
import { normalizeWorkflowName } from "../src/workflow/paths.ts";
import { readWorkflowInputContract } from "../src/workflow/start.ts";
import { reviewWorkflowCommand } from "./commands/review.ts";
import { workflowSettingsCommand } from "./commands/settings.ts";
import { workflowStatusCommand } from "./commands/status.ts";

/** Injectable Pi agent construction used by extension command and tool launches. */
export interface PiWorkflowExtensionDependencies {
  createAgent?: (options: PiWorkflowAgentOptions) => WorkflowAgent;
  createLLM?: (ctx: ExtensionContext) => WorkflowLLM;
}

/** Registers pi-workflow commands, tools, and TUI hooks with a Pi extension host. */
export default function piWorkflow(pi: ExtensionAPI, dependencies: PiWorkflowExtensionDependencies = {}): void {
  const createAgent = dependencies.createAgent ?? createPiWorkflowAgent;
  const createLLM =
    dependencies.createLLM ??
    ((ctx: ExtensionContext) =>
      createPiWorkflowLLM({
        model: ctx.model,
        getModels: () => ctx.modelRegistry.getAll(),
        getRequestAuth: async (model) => {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!auth.ok) throw new Error(`Pi model authentication failed: ${auth.error}`);
          return {
            ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
            ...(auth.headers === undefined ? {} : { headers: auth.headers }),
            ...(auth.env === undefined ? {} : { env: auth.env }),
          };
        },
      }));
  const aliases = new Set<string>();
  const capabilityCatalogs = new Map<string, AgentCapabilityCatalogProvider>();
  const capabilityCatalogForCwd = (cwd: string): AgentCapabilityCatalogProvider => {
    const existing = capabilityCatalogs.get(cwd);
    if (existing) return existing;
    const catalog = createParentAgentCapabilityCatalogProvider({ cwd, getTools: () => pi.getAllTools() });
    capabilityCatalogs.set(cwd, catalog);
    return catalog;
  };

  for (const tool of createWorkflowTools({
    run: {
      agentForContext: (ctx) => createAgent({ cwd: ctx.cwd, agentCapabilityCatalog: capabilityCatalogForCwd(ctx.cwd) }),
      llmForContext: createLLM,
      sendUserMessageForContext:
        () =>
        (message, options): void =>
          pi.sendUserMessage(message, options),
    },
    agentCapabilityCatalogForContext: (ctx) => capabilityCatalogForCwd(ctx.cwd),
  })) {
    pi.registerTool(tool);
  }

  pi.registerCommand("workflow", {
    description: "Run or create a project workflow in the current session",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => steerWorkflowCommand(pi, createAgent, createLLM, ctx, undefined, args, capabilityCatalogForCwd(ctx.cwd)),
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
    handler: async (_args, ctx) => {
      if (!(await openRunningWorkflowInspector(ctx))) ctx.ui.notify("No running workflows to view.", "warning");
    },
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
        handler: async (args, commandCtx) =>
          steerWorkflowCommand(pi, createAgent, createLLM, commandCtx, workflow.name, args, capabilityCatalogForCwd(commandCtx.cwd)),
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
  createAgent: (options: PiWorkflowAgentOptions) => WorkflowAgent,
  createLLM: (ctx: ExtensionContext) => WorkflowLLM,
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
  capabilityCatalog?: AgentCapabilityCatalogProvider,
): Promise<void> {
  if (fixedWorkflowName) {
    await runExistingWorkflowCommand(pi, createAgent, createLLM, ctx, normalizeWorkflowName(fixedWorkflowName), args, capabilityCatalog);
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
    await runExistingWorkflowCommand(pi, createAgent, createLLM, ctx, first, rest, capabilityCatalog);
    return;
  }

  ctx.ui.notify("Workflow request sent to current session", "info");
  sendWorkflowUserMessage(ctx, (message, options) => pi.sendUserMessage(message, options), naturalLanguageRequestMessage(trimmed, names));
}

async function runExistingWorkflowCommand(
  pi: ExtensionAPI,
  createAgent: (options: PiWorkflowAgentOptions) => WorkflowAgent,
  createLLM: (ctx: ExtensionContext) => WorkflowLLM,
  ctx: ExtensionCommandContext,
  workflowName: string,
  rawInput: string,
  capabilityCatalog?: AgentCapabilityCatalogProvider,
): Promise<void> {
  const workflow = (await discoverWorkflows(ctx.cwd)).find((candidate) => candidate.name === workflowName);
  if (!workflow) {
    ctx.ui.notify(`Workflow '${workflowName}' not found.`, "warning");
    return;
  }
  try {
    const inputContract = await readWorkflowInputContract(workflow);
    const parsedInput = parseWorkflowInput(rawInput);
    const sendUserMessage = (message: string, options?: { deliverAs?: "followUp" }): void => pi.sendUserMessage(message, options);
    if (parsedInput.action === "resolve") {
      ctx.ui.notify(`Workflow '${workflowName}' input resolution sent to current session`, "info");
      sendWorkflowUserMessage(
        ctx,
        sendUserMessage,
        steerableInputResolutionMessage({
          rawInput: parsedInput.rawInput,
          workflowName,
          metadata: workflow.metadata,
          contract: inputContract,
        }),
      );
      return;
    }
    const agent = createAgent({ cwd: ctx.cwd, ...(capabilityCatalog ? { agentCapabilityCatalog: capabilityCatalog } : {}) });
    const llm = createLLM(ctx);
    ctx.ui.notify(`Running workflow '${workflowName}' in the background`, "info");
    await startVisibleWorkflowRun({
      ctx,
      cwd: ctx.cwd,
      workflowName,
      input: parsedInput.input,
      agentDir: getAgentDir(),
      agent,
      llm,
      signal: ctx.signal,
      sendUserMessage,
    });
  } catch (error) {
    const message = error instanceof WorkflowInputError ? error.message : `Workflow '${workflowName}' failed: ${errorMessage(error)}`;
    ctx.ui.notify(message, error instanceof WorkflowInputError ? "warning" : "error");
    sendWorkflowUserMessage(
      ctx,
      (content, options) => pi.sendUserMessage(content, options),
      workflowFailureHandoffPrompt(workflowName, message),
    );
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
