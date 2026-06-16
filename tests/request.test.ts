import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveWorkflowRequest } from "../src/request.ts";
import type { WorkflowAgent } from "../src/runtime.ts";

const generatedWorkflowDocstring = `/**
 * Purpose: generated test workflow.
 * Args: expects a prompt-like input object from the user.
 * Phase: single implicit phase for smoke coverage.
 * Agent: no child agent is launched unless the body adds one.
 * Result: returns a JSON-serializable smoke result.
 */
`;

void test("generated_workflows_save_only_after_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-request-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const agent: WorkflowAgent = () => Promise.resolve(JSON.stringify({ action: "create", name: "summarize", source }));
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");

  await assert.rejects(resolveWorkflowRequest({ cwd: project, request: "summarize", agent }), /require review/);
  assert.equal(existsSync(workflowFile), false);

  const resolved = await resolveWorkflowRequest({
    cwd: project,
    request: "summarize",
    agent,
    reviewer: () => ({ action: "approve" }),
  });

  assert.equal(resolved.action, "created");
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("generated_workflows_pass_natural_language_proposal_to_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-request-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const proposal = {
    summary: "Create a reusable summarizer workflow.",
    steps: ["Read args.prompt", "Return it for smoke testing"],
    willRun: ["Save .pi/workflows/summarize/workflow.js", "Run summarize with the original request as prompt"],
  };
  const agent: WorkflowAgent = () => Promise.resolve(JSON.stringify({ action: "create", name: "summarize", source, proposal }));
  let reviewedProposal: unknown;

  const resolved = await resolveWorkflowRequest({
    cwd: project,
    request: "summarize",
    agent,
    reviewer: ({ draft }) => {
      reviewedProposal = draft.proposal;
      return { action: "approve" };
    },
  });

  assert.equal(resolved.action, "created");
  assert.deepEqual(reviewedProposal, proposal);
  assert.deepEqual(resolved.draft.proposal, proposal);
});

void test("generated_workflows_save_reviewer_updated_source", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-request-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const updatedSource = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files with edits" };
export default async function workflow() {
  return { prompt: args.prompt, reviewed: true };
}`;
  const agent: WorkflowAgent = () => Promise.resolve(JSON.stringify({ action: "create", name: "summarize", source }));
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");

  const resolved = await resolveWorkflowRequest({
    cwd: project,
    request: "summarize",
    agent,
    reviewer: () => ({ action: "approve", source: updatedSource }),
  });

  assert.equal(resolved.action, "created");
  assert.equal((await readFile(workflowFile, "utf8")).trim(), updatedSource);
});
