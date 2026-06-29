import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { defineTool, getAgentDir, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { startBackgroundWorkflowRun, type BackgroundWorkflowRunResult } from "./background-runs.ts";
import { workflowFinalOutputPath } from "./workflow-outputs.ts";
import { workflowRootsForProject } from "./discovery.ts";
import {
  normalizeWorkflowName,
  resolveWorkflowDirectory,
  runWorkflowFromDirectory,
  type WorkflowAgent,
  type WorkflowSnapshot,
} from "./runtime.ts";
import { progressDisplay } from "./display/progress.ts";
import { workflowResultPreview } from "./display/messages.ts";
import { reviewAndSaveWorkflowDraft, reviewWorkflowDraft, type WorkflowReviewer } from "./request.ts";
import { createWorkflowRunId } from "./run-logs.ts";
import { workflowDesignGuidance } from "./authoring-guide.ts";
import { extractWorkflowInputContract, validateWorkflowInput } from "./input.ts";
import { DEFAULT_MAX_PARALLEL_AGENTS, readWorkflowSettings } from "./workflow-settings.ts";
import { materializeWorkflowDraftForRun, readWorkflowDraft, workflowDraftProposal } from "./workflow-drafts.ts";

/** Dependencies used to construct workflow tools for either an extension session or tests. */
export interface WorkflowToolsOptions {
  cwd?: string;
  agent?: WorkflowAgent;
  agentForContext?: (ctx: ExtensionContext) => WorkflowAgent;
  reviewer?: WorkflowReviewer;
  reviewerForContext?: (ctx: ExtensionContext) => WorkflowReviewer;
}

/** Builds the public tool surface for running, debugging, authoring guidance, and proposing workflows. */
export function createWorkflowTools(options: WorkflowToolsOptions): ToolDefinition[] {
  return [
    createRunWorkflowTool(options),
    createDebugWorkflowTool(options),
    createWorkflowDesignGuidanceTool(),
    createProposeWorkflowTool(options),
  ];
}

interface RunWorkflowToolDetails {
  workflowName: string;
  status: "running" | "complete";
  snapshot?: WorkflowSnapshot;
  result?: unknown;
  runId?: string;
  outputsDir?: string;
  resultPath?: string;
  sessionLogDir?: string;
}

function createRunWorkflowTool(options: WorkflowToolsOptions): ToolDefinition {
  return defineTool({
    name: "run_workflow",
    label: "Run Workflow",
    description: "Run an existing project workflow by name.",
    promptSnippet: "run_workflow: Run an existing project workflow by name.",
    parameters: Type.Object({
      name: Type.String({ description: "Existing workflow name to run" }),
      input: Type.Optional(Type.Any({ description: "JSON-serializable workflow input" })),
      draftDir: Type.Optional(
        Type.String({ description: "Project-relative draft workflow directory to review and run once without saving" }),
      ),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      const agent = options.agent ?? options.agentForContext?.(ctx);
      if (!agent) throw new Error("run_workflow requires a workflow agent");
      const workflowName = normalizeWorkflowName(params.name);
      const sourceHandle = await workflowSourceForRun({
        cwd,
        workflowName,
        draftDir: typeof params.draftDir === "string" ? params.draftDir : undefined,
        request: `run workflow ${workflowName}`,
        reviewer: options.reviewer ?? options.reviewerForContext?.(ctx),
      });
      const workflowRoots = sourceHandle.workflowRoots;
      const workflowDir = sourceHandle.workflowDir;
      const source = await readFile(path.join(workflowDir, "workflow.js"), "utf8");
      const input = validateWorkflowInput(params.input ?? {}, workflowName, extractWorkflowInputContract(source));
      const parentRunId = createWorkflowRunId(workflowName);
      const workflowSettings = await readWorkflowSettings(cwd, getAgentDir());
      const run = await startBackgroundWorkflowRun({
        runId: parentRunId,
        cwd,
        workflowName,
        input,
        agent,
        workflowRoots,
        maxParallelAgents: workflowSettings.maxParallelAgents,
        agentLogParentId: parentRunId,
        signal,
        onSnapshot: (snapshot) => {
          onUpdate?.({
            content: [{ type: "text", text: progressDisplay(snapshot).text }],
            details: {
              workflowName,
              status: "running",
              snapshot,
              runId: parentRunId,
              outputsDir: run.outputsDir,
              resultPath: workflowFinalOutputPath(run.outputsDir),
            },
          });
        },
      });
      void run.finished
        .then((result) => notifyBackgroundToolCompletion(ctx, result))
        .catch((error: unknown) =>
          ctx.ui.notify(`Workflow ${workflowName} failed: ${error instanceof Error ? error.message : String(error)}`, "error"),
        );
      return {
        content: [
          {
            type: "text",
            text: `Workflow ${workflowName} started in the background.\n\nWorkflow outputs: ${run.outputsDir}\nWorkflow result: ${workflowFinalOutputPath(run.outputsDir)}`,
          },
        ],
        details: {
          workflowName,
          status: "running",
          runId: parentRunId,
          outputsDir: run.outputsDir,
          resultPath: workflowFinalOutputPath(run.outputsDir),
          snapshot: run.snapshot(),
          sourceKind: sourceHandle.sourceKind,
          saved: sourceHandle.sourceKind === "saved",
        },
      };
    },
    renderResult(result, _options, theme) {
      const details = result.details as RunWorkflowToolDetails;
      const snapshot = details.snapshot ?? emptySnapshot(details.workflowName);
      return new Text(progressDisplay(snapshot, 96, theme).text, 0, 0);
    },
  });
}

interface WorkflowSourceForRunOptions {
  cwd: string;
  workflowName: string;
  draftDir?: string;
  request: string;
  reviewer?: WorkflowReviewer;
}

interface WorkflowSourceForRun {
  workflowRoots: string[];
  workflowDir: string;
  sourceKind: "draftDir" | "saved";
}

async function workflowSourceForRun(options: WorkflowSourceForRunOptions): Promise<WorkflowSourceForRun> {
  if (!options.draftDir) {
    const workflowRoots = await workflowRootsForProject(options.cwd);
    return {
      workflowRoots,
      workflowDir: resolveWorkflowDirectory(options.cwd, options.workflowName, workflowRoots),
      sourceKind: "saved",
    };
  }
  const workflowRoot = await prepareWorkflowDraftForRun({ ...options, draftDir: options.draftDir });
  return {
    workflowRoots: [workflowRoot],
    workflowDir: path.join(workflowRoot, options.workflowName),
    sourceKind: "draftDir",
  };
}

async function prepareWorkflowDraftForRun(options: WorkflowSourceForRunOptions & { draftDir: string }): Promise<string> {
  const draft = await readWorkflowDraft({
    cwd: options.cwd,
    name: options.workflowName,
    draftDir: options.draftDir,
    proposal: {
      summary: `Review and run workflow draft '${options.workflowName}' once without saving it`,
      steps: ["Review the draft workflow directory.", "Run the approved draft from a temporary workflow root."],
      willRun: [
        `Review and run ${options.draftDir}/workflow.js once from a temporary workflow root.`,
        `Do not save files under .pi/workflows/${options.workflowName}/.`,
      ],
    },
    toolName: "run_workflow",
  });
  const approved = await reviewWorkflowDraft({
    cwd: options.cwd,
    request: options.request,
    draft,
    reviewer: options.reviewer,
    intent: "run",
  });
  return materializeWorkflowDraftForRun(approved);
}

function notifyBackgroundToolCompletion(ctx: ExtensionContext, result: BackgroundWorkflowRunResult): void {
  const resultLocation = result.resultPath ?? result.outputsDir ?? result.sessionLogDir;
  ctx.ui.notify(`Workflow ${result.workflowName} complete. Result: ${resultLocation}`, "info");
}

function emptySnapshot(workflowName: string): WorkflowSnapshot {
  return { workflowName, description: "", plannedPhases: [], phases: [], logs: [], traces: [], agents: [], fanOuts: [], messages: [] };
}

function createDebugWorkflowTool(options: WorkflowToolsOptions): ToolDefinition {
  return defineTool({
    name: "debug_workflow",
    label: "Debug Workflow",
    description:
      "Run a workflow.js draft in an isolated sandbox with fake child-agent responses. Use only for small snippets/simple tasks with minimal or low-thinking model labels.",
    promptSnippet:
      "debug_workflow: Debug a small workflow.js draft in a temp sandbox. Use fake agentResponses; keep tasks simple and reasoning/model cheap.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow name matching metadata.name" }),
      source: Type.String({ description: "Complete workflow.js source to debug without saving" }),
      input: Type.Optional(Type.Any({ description: "JSON-serializable workflow input" })),
      agentResponses: Type.Optional(Type.Array(Type.Any(), { description: "Fake child-agent responses consumed in launch order" })),
    }),
    async execute(_toolCallId, params, signal) {
      const cwd = options.cwd ?? (await mkdtemp(path.join(tmpdir(), "pi-workflow-debug-project-")));
      const workflowName = normalizeWorkflowName(params.name);
      const workflowRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-debug-"));
      const workflowDir = path.join(workflowRoot, workflowName);
      await mkdir(workflowDir, { recursive: true });
      await writeFile(path.join(workflowDir, "workflow.js"), params.source, "utf8");

      let lastSnapshot: WorkflowSnapshot | undefined;
      const calls: DebugAgentCall[] = [];
      const responses: unknown[] = Array.isArray(params.agentResponses) ? (params.agentResponses as unknown[]) : [];
      const agent: WorkflowAgent = (prompt) => {
        const response = responses[calls.length] ?? `debug response ${String(calls.length + 1)}`;
        calls.push({ prompt, response });
        return Promise.resolve(response);
      };

      try {
        const result = await runWorkflowFromDirectory({
          cwd,
          workflowName,
          input: params.input ?? {},
          agent,
          workflowRoots: [workflowRoot],
          maxParallelAgents: DEFAULT_MAX_PARALLEL_AGENTS,
          signal,
          onSnapshot: (snapshot) => {
            lastSnapshot = snapshot;
          },
        });
        return debugWorkflowResult("complete", result.result, result.snapshot, calls);
      } catch (error) {
        return debugWorkflowResult("error", error instanceof Error ? error.message : String(error), lastSnapshot, calls);
      }
    },
  });
}

function createWorkflowDesignGuidanceTool(): ToolDefinition {
  return defineTool({
    name: "workflow_design_guidance",
    label: "Workflow Design Guidance",
    description: "Show concise, topic-specific guidance for designing and authoring project workflows.",
    promptSnippet:
      "workflow_design_guidance: Get concise workflow design guidance by topic, such as overview, workflow-api, prompt-files, structured-outputs, fanout, verification, artifacts, or debugging.",
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({
          description: "Optional topic such as overview, workflow-api, draft-directory, prompt-files, structured-outputs, or debugging",
        }),
      ),
    }),
    execute(_toolCallId, params) {
      const text = workflowDesignGuidance(params.topic);
      return Promise.resolve({ content: [{ type: "text", text }], details: { topic: params.topic ?? "index" } });
    },
  });
}

interface DebugAgentCall {
  prompt: string;
  response: unknown;
}

function debugWorkflowResult(
  status: "complete" | "error",
  resultOrError: unknown,
  snapshot: WorkflowSnapshot | undefined,
  agents: DebugAgentCall[],
): { content: { type: "text"; text: string }[]; details: Record<string, unknown> } {
  const tokenCount = snapshot?.agents.reduce((total, agent) => total + agent.tokenCount, 0) ?? 0;
  const text =
    status === "complete"
      ? `Debug workflow complete.\n\nResult:\n${JSON.stringify(resultOrError, null, 2)}\n\nActual tokens used: ${String(tokenCount)}`
      : `Debug workflow error.\n\nError:\n${String(resultOrError)}\n\nActual tokens used: ${String(tokenCount)}`;
  return {
    content: [{ type: "text", text }],
    details: {
      status,
      snapshot,
      agents: agents.map(debugAgentCallPreview),
      ...(status === "complete" ? { result: resultOrError } : { error: resultOrError }),
    },
  };
}

function debugAgentCallPreview(call: DebugAgentCall): { promptPreview: string; responsePreview: string } {
  return { promptPreview: workflowResultPreview(call.prompt, 2000), responsePreview: workflowResultPreview(call.response, 2000) };
}

function createProposeWorkflowTool(options: WorkflowToolsOptions): ToolDefinition {
  return defineTool({
    name: "propose_workflow",
    label: "Propose Workflow",
    description: "Propose a new workflow draft directory for user review before it is saved.",
    promptSnippet: "propose_workflow: Propose a new workflow draft directory, not a workflow.js file, for user review before saving.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow slug to save under .pi/workflows/<slug>" }),
      source: Type.Optional(
        Type.String({
          description: "Compatibility path for tiny workflows: complete workflow.js source without resource files. Prefer draftDir.",
        }),
      ),
      draftDir: Type.Optional(
        Type.String({
          description: "Preferred: project-relative draft workflow directory containing workflow.js plus prompts/ or other resources",
        }),
      ),
      request: Type.Optional(Type.String({ description: "Original user request this workflow satisfies" })),
      summary: Type.Optional(Type.String({ description: "Natural-language summary shown to the user before save" })),
      steps: Type.Optional(Type.Array(Type.String(), { description: "Natural-language steps the workflow will take" })),
      willRun: Type.Optional(
        Type.Array(Type.String(), { description: "Commands, workflow calls, or agent tasks that will run after approval" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      const reviewer = options.reviewer ?? options.reviewerForContext?.(ctx);
      const name = normalizeWorkflowName(params.name);
      const draft = await readWorkflowDraft({
        cwd,
        name,
        source: params.source,
        draftDir: params.draftDir,
        proposal: workflowDraftProposal(params, name),
        toolName: "propose_workflow",
      });
      await reviewAndSaveWorkflowDraft({ cwd, request: params.request ?? name, draft, reviewer });
      return {
        content: [{ type: "text", text: `Saved reviewed workflow '${name}' to .pi/workflows/${name}/.` }],
        details: { workflowName: name, saved: true },
      };
    },
  });
}
