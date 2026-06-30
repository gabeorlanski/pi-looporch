import { Type } from "typebox";
import { defineTool, getAgentDir, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BackgroundWorkflowRunResult } from "./background-runs.ts";
import { workflowFinalOutputPath } from "./workflow/outputs.ts";
import type { WorkflowAgent } from "./runtime/types.ts";
import { progressDisplay } from "./display/progress.ts";
import { saveWorkflowDraft } from "./request.ts";
import { workflowDesignGuidance } from "./authoring-guide.ts";
import { readWorkflowDraft } from "./workflow/drafts.ts";
import { normalizeWorkflowName } from "./workflow/paths.ts";
import { startWorkflowRun } from "./workflow/start.ts";

/** Dependencies used to construct workflow tools for either an extension session or tests. */
export interface WorkflowToolsOptions {
  cwd?: string;
  agent?: WorkflowAgent;
  agentForContext?: (ctx: ExtensionContext) => WorkflowAgent;
}

/** Builds the public tool surface for running, authoring guidance, and proposing workflows. */
export function createWorkflowTools(options: WorkflowToolsOptions): ToolDefinition[] {
  return [createRunWorkflowTool(options), createWorkflowDesignGuidanceTool(), createProposeWorkflowTool(options)];
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
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      const workflowName = normalizeWorkflowName(params.name);
      const agent = options.agent ?? options.agentForContext?.(ctx);
      if (!agent) throw new Error("run_workflow requires a workflow agent");
      const started = await startWorkflowRun({
        cwd,
        workflowName,
        input: params.input ?? {},
        agentDir: getAgentDir(),
        agent,
        signal,
        onSnapshot: (snapshot) => {
          onUpdate?.({
            content: [{ type: "text", text: progressDisplay(snapshot).text }],
            details: {
              workflowName,
              status: "running",
              runId: started.runId,
              outputsDir: started.run.outputsDir,
              resultPath: workflowFinalOutputPath(started.run.outputsDir),
            },
          });
        },
      });
      void started.run.finished
        .then((result) => notifyBackgroundToolCompletion(ctx, result))
        .catch((error: unknown) =>
          ctx.ui.notify(`Workflow ${workflowName} failed: ${error instanceof Error ? error.message : String(error)}`, "error"),
        );
      return {
        content: [
          {
            type: "text",
            text: `Workflow ${workflowName} started in the background.\n\nWorkflow outputs: ${started.run.outputsDir}\nWorkflow result: ${workflowFinalOutputPath(started.run.outputsDir)}`,
          },
        ],
        details: {
          workflowName,
          status: "running",
          runId: started.runId,
          outputsDir: started.run.outputsDir,
          resultPath: workflowFinalOutputPath(started.run.outputsDir),
        },
      };
    },
  });
}

function notifyBackgroundToolCompletion(ctx: ExtensionContext, result: BackgroundWorkflowRunResult): void {
  const resultLocation = result.resultPath ?? result.outputsDir ?? result.sessionLogDir;
  ctx.ui.notify(`Workflow ${result.workflowName} complete. Result: ${resultLocation}`, "info");
}

function createWorkflowDesignGuidanceTool(): ToolDefinition {
  return defineTool({
    name: "workflow_design_guidance",
    label: "Workflow Design Guidance",
    description: "Show concise, topic-specific guidance for designing and authoring project workflows.",
    promptSnippet:
      "workflow_design_guidance: Get concise workflow design guidance by topic, such as overview, workflow-api, prompt-files, structured-outputs, fanout, verification, or artifacts.",
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({
          description: "Optional topic such as overview, workflow-api, draft-directory, prompt-files, structured-outputs, or artifacts",
        }),
      ),
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
      draftDir: Type.String({
        description: "Project-relative draft workflow directory containing workflow.js plus prompts/ or other resources",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = options.cwd ?? ctx.cwd;
      const name = normalizeWorkflowName(params.name);
      const draft = await readWorkflowDraft({
        cwd,
        name,
        draftDir: params.draftDir,
        toolName: "propose_workflow",
      });
      await saveWorkflowDraft({ cwd, draft });
      return {
        content: [{ type: "text", text: `Saved workflow '${name}' to .pi/workflows/${name}/.` }],
        details: { workflowName: name, saved: true },
      };
    },
  });
}
