import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { defineTool, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { workflowRootsForProject } from "./discovery.ts";
import {
  normalizeWorkflowName,
  parseWorkflowSourceMetadata,
  resolveWorkflowDirectory,
  runWorkflowFromDirectory,
  type WorkflowAgent,
  type WorkflowSnapshot,
} from "./runtime.ts";
import { progressDisplay } from "./display/progress.ts";
import { workflowResultPreview } from "./display/messages.ts";
import { reviewAndSaveWorkflowDraft, type WorkflowProposal, type WorkflowReviewer } from "./request.ts";
import { createWorkflowRunId } from "./run-logs.ts";
import { workflowPrimitiveGuide } from "./authoring-guide.ts";
import { extractWorkflowInputContract, validateWorkflowInput } from "./input.ts";
import { writeWorkflowSessionSummary } from "./session-logs.ts";
import { DEFAULT_MAX_PARALLEL_AGENTS, readProjectWorkflowSettings } from "./workflow-settings.ts";

export interface WorkflowToolsOptions {
  cwd?: string;
  agent?: WorkflowAgent;
  agentForContext?: (ctx: ExtensionContext) => WorkflowAgent;
  reviewer?: WorkflowReviewer;
  reviewerForContext?: (ctx: ExtensionContext) => WorkflowReviewer;
}

export function createWorkflowTools(options: WorkflowToolsOptions): ToolDefinition[] {
  return [
    createRunWorkflowTool(options),
    createDebugWorkflowTool(options),
    createWorkflowPrimitivesTool(),
    createProposeWorkflowTool(options),
  ];
}

interface RunWorkflowToolDetails {
  workflowName: string;
  status: "running" | "complete";
  snapshot: WorkflowSnapshot;
  result?: unknown;
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
    }),
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      const agent = options.agent ?? options.agentForContext?.(ctx);
      if (!agent) throw new Error("run_workflow requires a workflow agent");
      const workflowName = normalizeWorkflowName(params.name);
      const workflowRoots = await workflowRootsForProject(cwd);
      const workflowDir = resolveWorkflowDirectory(cwd, workflowName, workflowRoots);
      const source = await readFile(path.join(workflowDir, "workflow.js"), "utf8");
      const input = validateWorkflowInput(params.input ?? {}, workflowName, extractWorkflowInputContract(source));
      const parentRunId = createWorkflowRunId(workflowName);
      const workflowSettings = await readProjectWorkflowSettings(cwd);
      const result = await runWorkflowFromDirectory({
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
            details: { workflowName, status: "running", snapshot },
          });
        },
      });
      const sessionLogDir = await writeWorkflowSessionSummary({
        cwd,
        parentId: parentRunId,
        snapshot: result.snapshot,
        result: result.result,
      });
      return {
        content: [
          {
            type: "text",
            text: `Workflow ${result.workflowName} complete.\n\n${workflowResultPreview(result.result)}\n\nWorkflow session logs: ${sessionLogDir}`,
          },
        ],
        details: { workflowName: result.workflowName, status: "complete", snapshot: result.snapshot, result: result.result, sessionLogDir },
      };
    },
    renderResult(result, _options, theme) {
      const details = result.details as RunWorkflowToolDetails;
      return new Text(progressDisplay(details.snapshot, 96, theme).text, 0, 0);
    },
  });
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

function createWorkflowPrimitivesTool(): ToolDefinition {
  return defineTool({
    name: "workflow_primitives",
    label: "Workflow Primitives",
    description: "Show workflow authoring primitive documentation and examples.",
    promptSnippet:
      "workflow_primitives: Look up workflow globals such as agent, parallel, coerce, mapreduce, verifier, readText, renderPrompt.",
    parameters: Type.Object({
      primitive: Type.Optional(Type.String({ description: "Optional primitive name such as agent, coerce, mapreduce, or verifier" })),
    }),
    execute(_toolCallId, params) {
      const text = workflowPrimitiveGuide(params.primitive);
      return Promise.resolve({ content: [{ type: "text", text }], details: { primitive: params.primitive ?? "all" } });
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
    description: "Propose a new workflow draft directory or source file for user review before it is saved.",
    promptSnippet: "propose_workflow: Propose a new workflow draft directory for user review before saving.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow slug to save under .pi/workflows/<slug>" }),
      source: Type.Optional(Type.String({ description: "Complete workflow.js source. Prefer draftDir for large workflows." })),
      draftDir: Type.Optional(Type.String({ description: "Project-relative draft workflow directory containing workflow.js" })),
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
      const { source, sourceDirectory } = await readProposalSource(cwd, params.source, params.draftDir);
      const metadata = parseWorkflowSourceMetadata(source, name);
      const draft = {
        name,
        source,
        metadata,
        proposal: workflowProposalFromParams(params, name),
        ...(sourceDirectory ? { sourceDirectory } : {}),
      };
      await reviewAndSaveWorkflowDraft({ cwd, request: params.request ?? name, draft, reviewer });
      return {
        content: [{ type: "text", text: `Saved reviewed workflow '${name}' to .pi/workflows/${name}/workflow.js.` }],
        details: { workflowName: name, saved: true },
      };
    },
  });
}

async function readProposalSource(
  cwd: string,
  source: string | undefined,
  draftDir: string | undefined,
): Promise<{ source: string; sourceDirectory?: string }> {
  const hasSource = typeof source === "string";
  const hasDraftDir = typeof draftDir === "string" && draftDir.trim().length > 0;
  if (hasSource && hasDraftDir) throw new Error("propose_workflow requires exactly one of source or draftDir");
  if (!hasSource && !hasDraftDir) throw new Error("propose_workflow requires exactly one of source or draftDir");
  if (hasSource) return { source };
  if (typeof draftDir !== "string" || !draftDir.trim()) throw new Error("propose_workflow requires exactly one of source or draftDir");
  const sourceDirectory = resolveDraftWorkflowDirectory(cwd, draftDir);
  const stats = await stat(sourceDirectory);
  if (!stats.isDirectory()) throw new Error("propose_workflow draftDir must be a directory containing workflow.js");
  return { source: await readFile(path.join(sourceDirectory, "workflow.js"), "utf8"), sourceDirectory };
}

function resolveDraftWorkflowDirectory(cwd: string, draftDir: string): string {
  const projectRoot = path.resolve(cwd);
  const resolved = path.resolve(projectRoot, draftDir);
  const projectRelative = path.relative(projectRoot, resolved);
  if (projectRelative.startsWith("..") || path.isAbsolute(projectRelative))
    throw new Error("propose_workflow draftDir must stay inside the project directory");
  const publishedRoot = path.join(projectRoot, ".pi", "workflows");
  if (isInsideOrEqual(publishedRoot, resolved) || isInsideOrEqual(resolved, publishedRoot)) {
    throw new Error("propose_workflow draftDir must not be inside, equal to, or an ancestor of .pi/workflows");
  }
  return resolved;
}

function isInsideOrEqual(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function workflowProposalFromParams(
  params: { request?: string; summary?: string; steps?: string[]; willRun?: string[] },
  name: string,
): WorkflowProposal {
  return {
    summary: params.summary ?? `Create workflow '${name}'${params.request ? ` for: ${params.request}` : ""}`,
    steps: params.steps ?? ["Save the reviewed workflow source under the project workflow directory."],
    willRun: params.willRun ?? [`Copy the approved draft to .pi/workflows/${name}/ after approval.`],
  };
}
