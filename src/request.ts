import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { selectionPrompt } from "./prompt-templates.ts";
import { discoverWorkflows, type WorkflowReference } from "./discovery.ts";
import { normalizeWorkflowName, parseWorkflowSourceMetadata, type WorkflowAgent, type WorkflowMetadata } from "./runtime.ts";

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

export interface ReviewAndSaveWorkflowDraftOptions {
  cwd: string;
  request: string;
  draft: GeneratedWorkflowDraft;
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
  const approvedDraft = await reviewAndSaveWorkflowDraft({
    cwd: options.cwd,
    request: options.request,
    draft,
    reviewer: options.reviewer,
  });
  return { action: "created", name, input: { prompt: options.request }, draft: approvedDraft };
}

export async function reviewAndSaveWorkflowDraft(options: ReviewAndSaveWorkflowDraftOptions): Promise<GeneratedWorkflowDraft> {
  if (!options.reviewer) throw new Error("Generated workflows require review before they are saved or run");
  const decision = await options.reviewer({ cwd: options.cwd, draft: options.draft, request: options.request });
  if (decision.action === "reject") throw new Error(decision.reason ?? "Generated workflow was rejected");
  const approvedSource = decision.source ?? options.draft.source;
  validateGeneratedWorkflowDocstring(approvedSource);
  const approvedMetadata = parseWorkflowSourceMetadata(approvedSource, options.draft.name);
  const approvedDraft = { ...options.draft, source: approvedSource, metadata: approvedMetadata };
  await writeDraftFile(options.cwd, approvedDraft);
  return approvedDraft;
}

export function validateGeneratedWorkflowDocstring(source: string): void {
  const trimmedSource = source.trimStart();
  if (!trimmedSource.startsWith("/**"))
    throw new Error("Generated workflow source must start with a JSDoc docstring before it can be saved");
  const docstring = /\/\*\*([\s\S]*?)\*\//.exec(trimmedSource)?.[1];
  if (!docstring) throw new Error("Generated workflow source must start with a JSDoc docstring before it can be saved");
  const normalized = docstring.toLowerCase();
  for (const requiredTopic of ["args", "phase", "agent", "result"]) {
    if (!normalized.includes(requiredTopic))
      throw new Error(`Generated workflow JSDoc must document ${requiredTopic} before the workflow can be saved`);
  }
}

async function writeDraftFile(cwd: string, draft: GeneratedWorkflowDraft): Promise<void> {
  const workflowDir = path.join(path.resolve(cwd), ".pi", "workflows", draft.name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), `${draft.source.trim()}\n`, "utf8");
}

async function selectWorkflow(request: string, workflows: WorkflowReference[], agent: WorkflowAgent): Promise<WorkflowSelection> {
  const response = await agent(selectionPrompt(request, workflows), { label: "select workflow", reasoning: "low" }, () => undefined);
  return parseSelection(response);
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
