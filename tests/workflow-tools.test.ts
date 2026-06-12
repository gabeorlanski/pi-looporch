import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPiWorkflowAgentTools } from "../src/pi-agent.ts";
import { createWorkflowTools } from "../src/workflow-tools.ts";
import type { WorkflowAgent } from "../src/workflow-runtime.ts";

void test("pi_workflow_agent_exposes_workflow_tools_by_default", () => {
  const tools = createPiWorkflowAgentTools(process.cwd());

  assert.ok(tools.some((tool) => tool.name === "read"), "coding tools are still available");
  assert.ok(tools.some((tool) => tool.name === "run_workflow"), "existing workflows can be called by agents");
  assert.ok(tools.some((tool) => tool.name === "propose_workflow"), "new workflows can be proposed by agents");
});

void test("run_workflow_tool_runs_existing_workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input" };
export default async function workflow() {
  return { input: args, agent: await agent("say hi", { label: "helper" }) };
}`,
    "utf8",
  );
  const agent: WorkflowAgent = async (prompt, options) => `${options.label}:${prompt}`;
  const tool = createWorkflowTools({ cwd: project, agent }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name: "echo", input: { message: "hello" } }, undefined, undefined, {} as never);

  assert.deepEqual(result.details, {
    workflowName: "echo",
    result: { input: { message: "hello" }, agent: "helper:say hi" },
  });
});

void test("propose_workflow_tool_saves_only_after_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const toolWithoutReviewer = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(toolWithoutReviewer);

  await assert.rejects(
    toolWithoutReviewer.execute("call-1", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never),
    /require review/,
  );
  assert.equal(existsSync(workflowFile), false);

  const toolWithReviewer = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(toolWithReviewer);
  const result = await toolWithReviewer.execute("call-2", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never);

  assert.deepEqual(result.details, { workflowName: "summarize", saved: true });
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose_workflow_tool_passes_natural_language_proposal_to_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const proposal = {
    summary: "Create a summarizer workflow.",
    steps: ["Read args.prompt", "Return the prompt"],
    willRun: ["Save .pi/workflows/summarize/workflow.js"],
  };
  let reviewedProposal: unknown;
  const tool = createWorkflowTools({
    cwd: project,
    reviewer: ({ draft }) => {
      reviewedProposal = draft.proposal;
      return { action: "approve" };
    },
  }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await tool.execute("call-1", { name: "summarize", source, request: "summarize", ...proposal }, undefined, undefined, {} as never);

  assert.deepEqual(reviewedProposal, proposal);
});

void test("propose_workflow_tool_saves_reviewer_updated_source", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const updatedSource = `export const metadata = { name: "summarize", description: "Summarize files with edits" };
export default async function workflow() {
  return { prompt: args.prompt, reviewed: true };
}`;
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve", source: updatedSource }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await tool.execute("call-1", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never);

  assert.equal((await readFile(workflowFile, "utf8")).trim(), updatedSource);
});

void test("propose_workflow_tool_rejection_does_not_save", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "reject", reason: "not useful" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await assert.rejects(tool.execute("call-1", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never), /not useful/);

  assert.equal(existsSync(workflowFile), false);
});
