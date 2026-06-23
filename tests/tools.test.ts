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

void test("pi_workflow_agent_tools_combines_coding_and_workflow_tools_when_requested", () => {
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

void test("workflow_helper_tools_are_available_from_explicit_tool_factory", () => {
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
  const source = `export const metadata = { name: "draft", description: "Debug draft", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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

  const details = result.details as { status: string; result: unknown; agents: { promptPreview: string; responsePreview: string }[] };
  assert.equal(details.status, "complete");
  assert.deepEqual(details.result, { answer: "fake summary", topic: "docs" });
  assert.deepEqual(details.agents, [{ promptPreview: "summarize docs", responsePreview: "fake summary" }]);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Actual tokens used: 0/);
});

void test("debug_workflow_tool_reads_project_absolute_and_workflow_files", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const outside = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-readable-"));
  const absolutePath = path.join(outside, "absolute.txt");
  await mkdir(path.join(project, "fixtures"), { recursive: true });
  await writeFile(path.join(project, "fixtures", "project.txt"), "project", "utf8");
  await writeFile(absolutePath, "absolute", "utf8");
  const source = `export const metadata = { name: "readable", description: "Readable debug draft", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return {
    project: readText("fixtures/project.txt"),
    absolute: readText(args.absolutePath),
    workflowSourceIncludesMetadata: readText("@workflow/workflow.js").includes("Readable debug draft"),
  };
}`;
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "debug_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name: "readable", source, input: { absolutePath } }, undefined, undefined, {} as never);

  assert.equal((result.details as { status: string }).status, "complete");
  assert.deepEqual((result.details as { result: unknown }).result, {
    project: "project",
    absolute: "absolute",
    workflowSourceIncludesMetadata: true,
  });
});

void test("debug_workflow_tool_returns_errors_without_throwing", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "broken", description: "Broken draft", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
  const allText = all.content[0]?.type === "text" ? all.content[0].text : "";
  assert.match(allText, /Workflow primitives/);
  assert.match(allText, /workflow_primitives\(\{ primitive: "authoring" \}\)/);
  assert.match(allText, /paths and contracts, not pasted context/);
  assert.match(allText, /agent\(prompt: string/);
  assert.doesNotMatch(allText, /Debugging tip/i);

  const authoring = await tool.execute("call-2", { primitive: "authoring" }, undefined, undefined, {} as never);
  const authoringDocs = authoring.content[0]?.type === "text" ? authoring.content[0].text : "";
  assert.match(authoringDocs, /Budget-aware workflow authoring policy/);
  assert.match(authoringDocs, /do not embed large project files/);
  assert.match(authoringDocs, /artifactPaths/);

  const agentDocs = await tool.execute("call-3", { primitive: "agent" }, undefined, undefined, {} as never);
  const agentText = agentDocs.content[0]?.type === "text" ? agentDocs.content[0].text : "";
  assert.match(agentText, /taskFile/);
  assert.match(agentText, /tools\?: boolean/);
  assert.match(agentText, /artifactPaths/);
  assert.match(agentText, /source is not pasted/);

  const readText = await tool.execute("call-4", { primitive: "readText" }, undefined, undefined, {} as never);
  const readTextDocs = readText.content[0]?.type === "text" ? readText.content[0].text : "";
  assert.match(readTextDocs, /readText\(filePath: string\)/);
  assert.match(readTextDocs, /workflowPrompt = readText\("@workflow\/prompts\/review\.txt"\)/);
  assert.match(readTextDocs, /pass the path to a child agent/);

  const coerce = await tool.execute("call-5", { primitive: "coerce" }, undefined, undefined, {} as never);
  const text = coerce.content[0]?.type === "text" ? coerce.content[0].text : "";
  assert.match(text, /coerce\(/);
  assert.match(text, /maxLength/);
  assert.doesNotMatch(text, /verifier\(/);
});

void test("run_workflow_tool_runs_existing_workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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

void test("propose_workflow_tool_accepts_draft_directory_and_copies_assets_after_review", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return renderPrompt("summary.txt", { prompt: args.prompt });
}`;
  await mkdir(path.join(draftDir, "prompts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(draftDir, "workflow.js"), source, "utf8"),
    writeFile(path.join(draftDir, "prompts", "summary.txt"), "Summarize {{prompt}}", "utf8"),
  ]);
  const workflowDir = path.join(project, ".pi", "workflows", "summarize");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await tool.execute(
    "call-1",
    { name: "summarize", draftDir: path.relative(project, draftDir), request: "summarize" },
    undefined,
    undefined,
    {} as never,
  );

  assert.equal((await readFile(path.join(workflowDir, "workflow.js"), "utf8")).trim(), source);
  assert.equal(await readFile(path.join(workflowDir, "prompts", "summary.txt"), "utf8"), "Summarize {{prompt}}");
});

void test("propose_workflow_tool_rejects_draft_directory_inside_published_workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const draftDir = path.join(project, ".pi", "workflows", "summarize");
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await assert.rejects(
    tool.execute(
      "call-1",
      { name: "summarize", draftDir: path.relative(project, draftDir), request: "summarize" },
      undefined,
      undefined,
      {} as never,
    ),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose_workflow_tool_rejects_draft_directory_that_contains_published_workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  await mkdir(path.join(project, ".pi", "workflows"), { recursive: true });
  await writeFile(path.join(project, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project, reviewer: () => ({ action: "approve" }) }).find(
    (candidate) => candidate.name === "propose_workflow",
  );
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: ".", request: "summarize" }, undefined, undefined, {} as never),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose_workflow_tool_rejects_approved_source_without_docstring", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { prompt: args.prompt };
}`;
  const updatedSource = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files with edits", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
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
