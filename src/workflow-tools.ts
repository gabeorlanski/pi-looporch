import { Type } from "typebox";
import { defineTool, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { workflowRootsForProject } from "./workflow-discovery.ts";
import {
  parseWorkflowSourceMetadata,
  normalizeWorkflowName,
  runWorkflowFromDirectory,
  type WorkflowAgent,
  type WorkflowSnapshot,
} from "./workflow-runtime.ts";
import { workflowProgressText } from "./workflow-progress.ts";
import { saveWorkflowDraft, type WorkflowProposal, type WorkflowReviewer } from "./workflow-request.ts";

export interface WorkflowToolsOptions {
  cwd?: string;
  agent?: WorkflowAgent;
  agentForContext?: (ctx: ExtensionContext) => WorkflowAgent;
  reviewer?: WorkflowReviewer;
  reviewerForContext?: (ctx: ExtensionContext) => WorkflowReviewer;
}

export function createWorkflowTools(options: WorkflowToolsOptions): ToolDefinition[] {
  return [createRunWorkflowTool(options), createProposeWorkflowTool(options)];
}

interface RunWorkflowToolDetails {
  workflowName: string;
  status: "running" | "complete";
  snapshot: WorkflowSnapshot;
  result?: unknown;
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
      const result = await runWorkflowFromDirectory({
        cwd,
        workflowName,
        input: params.input ?? {},
        agent,
        workflowRoots: await workflowRootsForProject(cwd),
        signal,
        onSnapshot: (snapshot) => {
          onUpdate?.({
            content: [{ type: "text", text: workflowProgressText(snapshot) }],
            details: { workflowName, status: "running", snapshot },
          });
        },
      });
      return {
        content: [{ type: "text", text: `Workflow ${result.workflowName} complete.\n\n${JSON.stringify(result.result, null, 2)}` }],
        details: { workflowName: result.workflowName, status: "complete", snapshot: result.snapshot, result: result.result },
      };
    },
    renderResult(result, _options, theme) {
      const details = result.details as RunWorkflowToolDetails;
      return new Text(theme.fg(details.status === "complete" ? "success" : "accent", workflowProgressText(details.snapshot)), 0, 0);
    },
  });
}

function createProposeWorkflowTool(options: WorkflowToolsOptions): ToolDefinition {
  return defineTool({
    name: "propose_workflow",
    label: "Propose Workflow",
    description: "Propose a new workflow source file for user review before it is saved.",
    promptSnippet: "propose_workflow: Propose a new workflow for user review before saving.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow slug to save under .pi/workflows/<slug>" }),
      source: Type.String({ description: "Complete workflow.js source" }),
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
      const metadata = parseWorkflowSourceMetadata(params.source, name);
      const draft = { name, source: params.source, metadata, proposal: workflowProposalFromParams(params, name) };
      if (!reviewer) throw new Error("Generated workflows require review before they are saved or run");
      const decision = await reviewer({ cwd, draft, request: params.request ?? name });
      if (decision.action === "reject") throw new Error(decision.reason ?? "Generated workflow was rejected");
      const approvedSource = decision.source ?? draft.source;
      const approvedMetadata = parseWorkflowSourceMetadata(approvedSource, name);
      await saveWorkflowDraft(cwd, { name, source: approvedSource, metadata: approvedMetadata, proposal: draft.proposal });
      return {
        content: [{ type: "text", text: `Saved reviewed workflow '${name}' to .pi/workflows/${name}/workflow.js.` }],
        details: { workflowName: name, saved: true },
      };
    },
  });
}

function workflowProposalFromParams(
  params: { request?: string; summary?: string; steps?: string[]; willRun?: string[] },
  name: string,
): WorkflowProposal {
  return {
    summary: params.summary ?? `Create workflow '${name}'${params.request ? ` for: ${params.request}` : ""}`,
    steps: params.steps ?? ["Save the reviewed workflow source under the project workflow directory."],
    willRun: params.willRun ?? [`Save .pi/workflows/${name}/workflow.js after approval.`],
  };
}
