import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPiWorkflowAgentTools } from "../src/pi-agent.ts";
import { createWorkflowTools } from "../src/tools.ts";
import type { WorkflowAgent } from "../src/runtime.ts";

const generatedWorkflowDocstring = `/**
 * Purpose: generated test workflow.
 * Args: expects a prompt-like input object from the user.
 * Phase: single implicit phase for smoke coverage.
 * Agent: no child agent is launched unless the body adds one.
 * Result: returns a JSON-serializable smoke result.
 */
`;

void test("pi_workflow_agent_exposes_workflow_tools_by_default", () => {
  const tools = createPiWorkflowAgentTools(process.cwd());

  assert.ok(
    tools.some((tool) => tool.name === "read"),
    "coding tools are still available",
  );
  assert.ok(
    tools.some((tool) => tool.name === "run_workflow"),
    "existing workflows can be called by agents",
  );
  assert.ok(
    tools.some((tool) => tool.name === "propose_workflow"),
    "new workflows can be proposed by agents",
  );
});

void test("workflow_helper_tools_are_exposed_by_default", () => {
  const tools = createPiWorkflowAgentTools(process.cwd());

  assert.ok(
    tools.some((tool) => tool.name === "debug_workflow"),
    "workflow drafts can be debugged by agents",
  );
  assert.ok(
    tools.some((tool) => tool.name === "workflow_primitives"),
    "workflow primitive docs are available to agents",
  );
});

void test("debug_workflow_tool_runs_source_with_fake_agent_responses", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "draft", description: "Debug draft" };
export default async function workflow() {
  phase("debug");
  const answer = await agent("summarize " + args.topic, { label: "summary", reasoning: "minimal", model: "cheap" });
  return { answer, topic: args.topic };
}`;
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "debug_workflow");
  assert.ok(tool);

  const result = await tool.execute(
    "call-1",
    { name: "draft", source, input: { topic: "docs" }, agentResponses: ["fake summary"] },
    undefined,
    undefined,
    {} as never,
  );

  const details = result.details as { status: string; result: unknown; agents: { prompt: string; response: unknown }[] };
  assert.equal(details.status, "complete");
  assert.deepEqual(details.result, { answer: "fake summary", topic: "docs" });
  assert.deepEqual(details.agents, [{ prompt: "summarize docs", response: "fake summary" }]);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Actual tokens used: 0/);
});

void test("debug_workflow_tool_returns_errors_without_throwing", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "broken", description: "Broken draft" };
export default async function workflow() {
  return missingGlobal;
}`;
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "debug_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name: "broken", source }, undefined, undefined, {} as never);

  assert.equal((result.details as { status: string }).status, "error");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /missingGlobal is not defined/);
});

void test("workflow_primitives_tool_returns_docs_and_examples", async () => {
  const tool = createWorkflowTools({ cwd: process.cwd() }).find((candidate) => candidate.name === "workflow_primitives");
  assert.ok(tool);

  const all = await tool.execute("call-1", {}, undefined, undefined, {} as never);
  assert.match(all.content[0]?.type === "text" ? all.content[0].text : "", /Available workflow globals/);
  assert.match(all.content[0]?.type === "text" ? all.content[0].text : "", /debugging tip/i);
  assert.match(all.content[0]?.type === "text" ? all.content[0].text : "", /does not pass prior agent responses/i);

  const coerce = await tool.execute("call-2", { primitive: "coerce" }, undefined, undefined, {} as never);
  const text = coerce.content[0]?.type === "text" ? coerce.content[0].text : "";
  assert.match(text, /coerce\(/);
  assert.doesNotMatch(text, /verifier\(/);
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
  const agent: WorkflowAgent = (prompt, options) => Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  const tool = createWorkflowTools({ cwd: project, agent }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);

  const updates: string[] = [];
  const result = await tool.execute(
    "call-1",
    { name: "echo", input: { message: "hello" } },
    undefined,
    (partial) => {
      const content = partial.content[0];
      if (content.type === "text") updates.push(content.text);
    },
    {} as never,
  );

  const details = result.details as { workflowName: string; result: unknown; status: string };
  assert.equal(details.workflowName, "echo");
  assert.equal(details.status, "complete");
  assert.deepEqual(details.result, { input: { message: "hello" }, agent: "helper:say hi" });
  assert.ok(
    updates.some((update) => update.includes("workflow echo") && update.includes("#1 helper") && update.includes("NET 0/1 agents")),
  );
});

void test("propose_workflow_tool_saves_only_after_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
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

  const toolWithReviewer = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(toolWithReviewer);
  const result = await toolWithReviewer.execute(
    "call-2",
    { name: "summarize", source, request: "summarize" },
    undefined,
    undefined,
    {} as never,
  );

  assert.deepEqual(result.details, { workflowName: "summarize", saved: true });
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose_workflow_tool_rejects_approved_source_without_docstring", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-2", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never),
    /must start with a JSDoc docstring/,
  );
});

void test("propose_workflow_tool_passes_natural_language_proposal_to_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const updatedSource = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files with edits" };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files" };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "reject", reason: "not useful" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", source, request: "summarize" }, undefined, undefined, {} as never),
    /not useful/,
  );

  assert.equal(existsSync(workflowFile), false);
});
