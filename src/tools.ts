/** Provides tools behavior. */
import { Type } from "typebox";
import { defineTool, getAgentDir, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resumeVisibleWorkflowRun, startVisibleWorkflowRun } from "./display/visible-workflow-run.ts";
import type { SendWorkflowUserMessage } from "./display/workflow-user-message.ts";
import { workflowFinalOutputPath } from "./workflow/outputs.ts";
import type { WorkflowAgent, WorkflowLLM, WorkflowSnapshot } from "./runtime/types.ts";
import { progressDisplay } from "./display/progress.ts";
import { saveWorkflowDraft } from "./workflow/draft-save.ts";
import { workflowDesignGuidance } from "./authoring-guide.ts";
import { readWorkflowDraft } from "./workflow/drafts.ts";
import { normalizeWorkflowName } from "./workflow/paths.ts";
import { renderWorkflowStatus, renderWorkflowStatusJson } from "./display/workflow-status.ts";
import { readSelectedWorkflowStatus, type WorkflowStatusQuery } from "./workflow/status.ts";
import type { AgentCapabilityCatalogProvider } from "./pi-agent/capabilities/catalog.ts";
import { validateWorkflowAgentCapabilities } from "./workflow/agent-capability-validation.ts";
import { readWorkflowSettings } from "./workflow/settings.ts";

/** Dependencies used to construct the complete production workflow tool surface. */
export interface WorkflowToolsOptions {
  run: WorkflowRunToolOptions;
  agentCapabilityCatalogForContext: (ctx: ExtensionContext) => AgentCapabilityCatalogProvider;
}

/** Pi-owned runtime and message boundaries required by run and resume tools. */
export interface WorkflowRunToolOptions {
  runtimeForContext: (ctx: ExtensionContext) => { agent: WorkflowAgent; llm: WorkflowLLM };
  sendUserMessageForContext: (ctx: ExtensionContext) => SendWorkflowUserMessage;
}

/** Builds the public tool surface for running, authoring guidance, and proposing workflows. */
export function createWorkflowTools(options: WorkflowToolsOptions): ToolDefinition[] {
  return [
    createRunWorkflowTool(options.run),
    createResumeWorkflowTool(options.run),
    createWorkflowStatusTool(),
    createGuidanceTool(),
    createProposeWorkflowTool(options),
  ];
}

function createRunWorkflowTool(options: WorkflowRunToolOptions): ToolDefinition {
  return defineTool({
    name: "run_workflow",
    label: "Run Workflow",
    description: "Run an existing project workflow and return a run ID that can resume failed or aborted runs.",
    promptSnippet: "run_workflow: Run a workflow and keep its returned run ID for resume_workflow after failure or abort.",
    parameters: Type.Object({
      name: Type.String({ description: "Existing workflow name to run" }),
      input: Type.Optional(Type.Any({ description: "JSON-serializable workflow input" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const workflowName = normalizeWorkflowName(params.name);
      const { agent, llm } = options.runtimeForContext(ctx);
      const sendUserMessage = options.sendUserMessageForContext(ctx);
      const visible = await startVisibleWorkflowRun({
        ctx,
        cwd,
        workflowName,
        input: params.input ?? {},
        agentDir: getAgentDir(),
        agent,
        llm,
        signal,
        sendUserMessage,
        onSnapshot: workflowToolSnapshot(onUpdate),
      });
      return runningWorkflowToolResult("started", visible);
    },
  });
}

function createResumeWorkflowTool(options: WorkflowRunToolOptions): ToolDefinition {
  return defineTool({
    name: "resume_workflow",
    label: "Resume Workflow",
    description: "Resume a failed or aborted workflow run from its completed model calls in this session.",
    promptSnippet: "resume_workflow: Resume a failed or aborted workflow run by run ID in the current session.",
    parameters: Type.Object({
      runId: Type.String({ description: "Run ID returned by run_workflow or a workflow failure handoff" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const visible = await resumeVisibleWorkflowRun({
        ctx,
        cwd,
        runId: params.runId,
        agentDir: getAgentDir(),
        ...options.runtimeForContext(ctx),
        signal,
        sendUserMessage: options.sendUserMessageForContext(ctx),
        onSnapshot: workflowToolSnapshot(onUpdate),
      });
      return runningWorkflowToolResult("resumed", visible);
    },
  });
}

function workflowToolSnapshot(
  onUpdate:
    | ((partialResult: { content: { type: "text"; text: string }[]; details: ReturnType<typeof runningWorkflowToolDetails> }) => void)
    | undefined,
): (snapshot: WorkflowSnapshot, prepared: { workflowName: string; runId: string }, run: { outputsDir: string }) => void {
  return (snapshot, prepared, run) => {
    onUpdate?.({
      content: [{ type: "text", text: progressDisplay(snapshot).text }],
      details: runningWorkflowToolDetails(prepared.workflowName, prepared.runId, run.outputsDir),
    });
  };
}

function runningWorkflowToolResult(
  action: "started" | "resumed",
  visible: { prepared: { workflowName: string }; run: { runId: string; outputsDir: string } },
): {
  content: { type: "text"; text: string }[];
  details: ReturnType<typeof runningWorkflowToolDetails>;
} {
  return {
    content: [
      {
        type: "text" as const,
        text: `Workflow ${visible.prepared.workflowName} ${action} in the background.\n\nWorkflow run ID: ${visible.run.runId}\nWorkflow outputs: ${visible.run.outputsDir}\nWorkflow result: ${workflowFinalOutputPath(visible.run.outputsDir)}`,
      },
    ],
    details: runningWorkflowToolDetails(visible.prepared.workflowName, visible.run.runId, visible.run.outputsDir),
  };
}

function runningWorkflowToolDetails(
  workflowName: string,
  runId: string,
  outputsDir: string,
): {
  workflowName: string;
  status: "running";
  runId: string;
  outputsDir: string;
  resultPath: string;
} {
  return {
    workflowName,
    status: "running",
    runId,
    outputsDir,
    resultPath: workflowFinalOutputPath(outputsDir),
  };
}

function createWorkflowStatusTool(): ToolDefinition {
  return defineTool({
    name: "workflow_status",
    label: "Workflow Status",
    description: "Summarize active pi workflows in this project.",
    promptSnippet: "workflow_status: Summarize active pi workflows in this project.",
    parameters: Type.Object({
      scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("current-session")])),
      ref: Type.Optional(Type.String()),
      format: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("json")])),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const query: WorkflowStatusQuery = {
        scope: params.scope ?? "project",
        ownerSessionId: ctx.sessionManager.getSessionId(),
        ref: params.ref ?? "latest",
        now: Date.now(),
      };
      const status = await readSelectedWorkflowStatus(cwd, query);
      return {
        content: [
          {
            type: "text",
            text: params.format === "json" ? renderWorkflowStatusJson(status) : renderWorkflowStatus(status),
          },
        ],
        details: status,
      };
    },
  });
}

function createGuidanceTool(): ToolDefinition {
  return defineTool({
    name: "workflow_design_guidance",
    label: "Workflow Design Guidance",
    description: "Load one topic of project-workflow authoring requirements.",
    promptSnippet:
      "workflow_design_guidance: Authoring help. Start with overview; load prompt-files before child prompts, then only active branches.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "Topic name; omit to list available branches." })),
    }),
    execute(_toolCallId, params) {
      const text = workflowDesignGuidance(params.topic);
      return Promise.resolve({ content: [{ type: "text", text }], details: { topic: params.topic ?? "index" } });
    },
  });
}

function createProposeWorkflowTool(options: WorkflowToolsOptions): ToolDefinition {
  return defineTool({
    name: "propose_workflow",
    label: "Propose Workflow",
    description: "Save a new workflow from a complete draft directory.",
    promptSnippet: "propose_workflow: Save a new workflow from a complete draft directory, not a workflow.js file.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow slug to save under .pi/workflows/<slug>" }),
      draftDir: Type.Optional(
        Type.String({
          description:
            "Draft workflow directory containing workflow.js plus prompts/ or other resources; accepts absolute paths or project-relative paths. Omit when using the default temp draft directory.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const name = normalizeWorkflowName(params.name);
      const draft = await readWorkflowDraft({
        cwd,
        name,
        draftDir: params.draftDir,
      });
      const settings = await readWorkflowSettings(cwd, getAgentDir());
      await validateWorkflowAgentCapabilities({
        source: draft.source,
        workflowName: name,
        defaultExtensions: settings.childAgentExtensions,
        defaultTools: settings.childAgentTools,
        catalogProvider: options.agentCapabilityCatalogForContext(ctx),
      });
      await saveWorkflowDraft({ cwd, draft });
      return {
        content: [{ type: "text", text: `Saved workflow '${name}' to .pi/workflows/${name}/.` }],
        details: { workflowName: name, saved: true },
      };
    },
  });
}
