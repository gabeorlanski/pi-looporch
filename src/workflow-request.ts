import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { discoverWorkflows, type WorkflowReference } from "./workflow-discovery.ts";
import {
  normalizeWorkflowName,
  parseWorkflowSourceMetadata,
  type WorkflowAgent,
  type WorkflowAgentProgress,
  type WorkflowMetadata,
} from "./workflow-runtime.ts";

export interface WorkflowSelectionRun {
  action: "run";
  name: string;
  input: unknown;
}

export interface WorkflowProposal {
  summary: string;
  steps: string[];
  willRun: string[];
}

export interface WorkflowSelectionCreate {
  action: "create";
  name: string;
  source: string;
  proposal?: WorkflowProposal;
}

export type WorkflowSelection = WorkflowSelectionRun | WorkflowSelectionCreate;

export interface GeneratedWorkflowDraft {
  name: string;
  source: string;
  metadata: WorkflowMetadata;
  proposal: WorkflowProposal;
}

export interface WorkflowReviewRequest {
  cwd: string;
  draft: GeneratedWorkflowDraft;
  request: string;
}

export type WorkflowReviewDecision = { action: "approve"; source?: string } | { action: "reject"; reason?: string };

export type WorkflowReviewer = (request: WorkflowReviewRequest) => Promise<WorkflowReviewDecision> | WorkflowReviewDecision;

export interface ResolveWorkflowRequestOptions {
  cwd: string;
  request: string;
  agent: WorkflowAgent;
  reviewer?: WorkflowReviewer;
}

export type ResolvedWorkflowRequest =
  | { action: "run"; name: string; input: unknown }
  | { action: "created"; name: string; input: unknown; draft: GeneratedWorkflowDraft };

export async function resolveWorkflowRequest(options: ResolveWorkflowRequestOptions): Promise<ResolvedWorkflowRequest> {
  const workflows = await discoverWorkflows(options.cwd);
  const selection = await selectWorkflow(options.request, workflows, options.agent);
  if (selection.action === "run") {
    const name = normalizeWorkflowName(selection.name);
    if (!workflows.some((workflow) => workflow.name === name)) throw new Error(`Selected workflow '${name}' does not exist`);
    return { action: "run", name, input: selection.input };
  }

  const name = normalizeWorkflowName(selection.name);
  const metadata = parseWorkflowSourceMetadata(selection.source, name);
  const draft = {
    name,
    source: selection.source,
    metadata,
    proposal: normalizeWorkflowProposal(selection.proposal, options.request, name),
  };
  if (!options.reviewer) throw new Error("Generated workflows require review before they are saved or run");
  const decision = await options.reviewer({ cwd: options.cwd, draft, request: options.request });
  if (decision.action === "reject") throw new Error(decision.reason ?? "Generated workflow was rejected");
  const approvedSource = decision.source ?? draft.source;
  const approvedMetadata = parseWorkflowSourceMetadata(approvedSource, name);
  const approvedDraft = { name, source: approvedSource, metadata: approvedMetadata, proposal: draft.proposal };
  await saveWorkflowDraft(options.cwd, approvedDraft);
  return { action: "created", name, input: { prompt: options.request }, draft: approvedDraft };
}

export async function saveWorkflowDraft(cwd: string, draft: GeneratedWorkflowDraft): Promise<void> {
  const workflowDir = path.join(path.resolve(cwd), ".pi", "workflows", draft.name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), `${draft.source.trim()}\n`, "utf8");
}

async function selectWorkflow(request: string, workflows: WorkflowReference[], agent: WorkflowAgent): Promise<WorkflowSelection> {
  const response = await agent(selectionPrompt(request, workflows), { label: "select workflow", reasoning: "low" }, ignoreProgress);
  return parseSelection(response);
}

function ignoreProgress(progress: WorkflowAgentProgress): void {
  void progress;
}

function selectionPrompt(request: string, workflows: WorkflowReference[]): string {
  return [
    "Select an existing workflow or create a new workflow for this Pi request.",
    "Return only JSON.",
    'For an existing workflow: {"action":"run","name":"workflow-name","input":{...}}',
    'For a new workflow: {"action":"create","name":"workflow-name","proposal":{"summary":"...","steps":["..."],"willRun":["..."]},"source":"export const metadata = ..."}',
    "Generated workflow source must not import modules. It must export `metadata` and a default workflow function.",
    "For new workflows, proposal.summary, proposal.steps, and proposal.willRun must explain in natural language what the user will review and what will run.",
    "Available workflows:",
    JSON.stringify(
      workflows.map((workflow) => ({
        name: workflow.name,
        description: workflow.metadata.description,
      })),
      null,
      2,
    ),
    "Request:",
    request,
  ].join("\n\n");
}

function parseSelection(value: unknown): WorkflowSelection {
  const raw = typeof value === "object" && value !== null && "selection" in value ? value.selection : value;
  if (typeof raw !== "string") throw new Error("Workflow selector must return JSON text");
  const parsed = JSON.parse(extractJson(raw)) as unknown;
  if (!isSelection(parsed)) throw new Error("Workflow selector returned an invalid action");
  return parsed;
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  return (fenced ?? text).trim();
}

function normalizeWorkflowProposal(proposal: WorkflowProposal | undefined, request: string, name: string): WorkflowProposal {
  if (proposal) return proposal;
  return {
    summary: `Create workflow '${name}' for: ${request}`,
    steps: ["Save the reviewed workflow source under the project workflow directory."],
    willRun: [`Run workflow '${name}' with the original request as input after approval.`],
  };
}

function isSelection(value: unknown): value is WorkflowSelection {
  if (typeof value !== "object" || value === null) return false;
  const action = (value as { action?: unknown }).action;
  if (action === "run") {
    const candidate = value as { name?: unknown };
    return typeof candidate.name === "string";
  }
  if (action === "create") {
    const candidate = value as { name?: unknown; source?: unknown; proposal?: unknown };
    return typeof candidate.name === "string" && typeof candidate.source === "string" && isOptionalWorkflowProposal(candidate.proposal);
  }
  return false;
}

function isOptionalWorkflowProposal(value: unknown): value is WorkflowProposal | undefined {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { summary?: unknown; steps?: unknown; willRun?: unknown };
  return (
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.steps) &&
    candidate.steps.every((step) => typeof step === "string") &&
    Array.isArray(candidate.willRun) &&
    candidate.willRun.every((step) => typeof step === "string")
  );
}
