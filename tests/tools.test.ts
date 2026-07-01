import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorkflowTools } from "../src/tools.ts";
import type { WorkflowAgent } from "../src/runtime/types.ts";

const trustedToolContext = { isProjectTrusted: () => true } as never;

const generatedWorkflowDocstring = `/**
 * Purpose: generated test workflow.
 * Args: expects a prompt-like input object from the user.
 * Phase: single implicit phase for smoke coverage.
 * Agent: no child agent is launched unless the body adds one.
 * Result: returns a JSON-serializable smoke result.
 */
`;

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition was not met before timeout");
}

void test("workflow_design_guidance_tool_returns_topic_index_and_focused_guidance", async () => {
  const tool = createWorkflowTools({ cwd: process.cwd() }).find((candidate) => candidate.name === "workflow_design_guidance");
  assert.ok(tool);

  const all = await tool.execute("call-1", {}, undefined, undefined, {} as never);
  const allText = all.content[0]?.type === "text" ? all.content[0].text : "";
  assert.match(allText, /Workflow design guidance/);
  assert.match(allText, /overview/);
  assert.match(allText, /workflow-api/);
  assert.match(allText, /prompt-files/);
  assert.doesNotMatch(allText, /Available workflow globals/);
  assert.doesNotMatch(allText, /additionalProperties/);

  const overview = await tool.execute("call-2", { topic: "overview" }, undefined, undefined, {} as never);
  const overviewText = overview.content[0]?.type === "text" ? overview.content[0].text : "";
  assert.match(overviewText, /workflow_design_guidance: overview|Workflow design guidance: overview/);
  assert.match(overviewText, /draftDir pointing at that directory/);
  assert.match(overviewText, /prompts\/\*\.txt/);

  const api = await tool.execute("call-3", { topic: "workflow-api" }, undefined, undefined, {} as never);
  const apiText = api.content[0]?.type === "text" ? api.content[0].text : "";
  assert.match(apiText, /Runtime globals are listed in the session prompt/);
  assert.match(apiText, /cannot import modules/);

  const promptFiles = await tool.execute("call-4", { topic: "prompt-files" }, undefined, undefined, {} as never);
  const promptFilesText = promptFiles.content[0]?.type === "text" ? promptFiles.content[0].text : "";
  assert.match(promptFilesText, /Inputs, Purpose, Definitions, Rules, Task, and Output/);
  assert.match(promptFilesText, /\{\{file\}\}/);
  assert.match(promptFilesText, /do not write JS template variables/);
  assert.match(promptFilesText, /Avoid unstructured global preamble dumps/);

  const structured = await tool.execute("call-5", { topic: "structured-outputs" }, undefined, undefined, {} as never);
  const structuredText = structured.content[0]?.type === "text" ? structured.content[0].text : "";
  assert.match(structuredText, /agent\(prompt, \{ schema, maxAttempts \}\)/);
  assert.match(structuredText, /maxLength/);
  assert.match(structuredText, /control surface/);
  assert.match(structuredText, /JSONL\/artifact files/);
  assert.doesNotMatch(structuredText, /verifier\(/);
});

void test("run_workflow_tool_runs_existing_workflow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  return { input, agent: await agent("say hi", { label: "helper" }) };
}`,
    "utf8",
  );
  const agent: WorkflowAgent = (prompt, options) => Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  const tool = createWorkflowTools({ cwd: project, agent }).find((candidate) => candidate.name === "run_workflow");
  assert.ok(tool);

  const updates: string[] = [];
  const notifications: string[] = [];
  const toolContext = {
    mode: "print",
    sessionManager: {
      getSessionId: () => "tool-session",
    },
    ui: { notify: (message: string) => notifications.push(message) },
    isProjectTrusted: () => true,
  } as never;
  const result = await tool.execute(
    "call-1",
    { name: "echo", input: { message: "hello" } },
    undefined,
    (partial) => {
      const content = partial.content[0];
      if (content.type === "text") updates.push(content.text);
    },
    toolContext,
  );

  const details = result.details as { workflowName: string; status: string; outputsDir: string; resultPath: string };
  assert.equal(details.workflowName, "echo");
  assert.equal(details.status, "running");
  assert.match(details.outputsDir, /pi-workflow-.*echo/);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Workflow echo started in the background/);
  await waitForCondition(() => updates.some((update) => update.includes("workflow echo") && update.includes("#1 helper")));
  await waitForCondition(() => notifications.some((message) => message.includes("Workflow echo complete")));
  const completionNotice = notifications.find((message) => message.includes("Workflow echo complete")) ?? "";
  assert.match(completionNotice, /Result: .*final\.json/);
  assert.match(completionNotice, /Workflow outputs: /);
  assert.match(completionNotice, /Session logs: /);
  assert.deepEqual(JSON.parse(await readFile(path.join(details.outputsDir, "outputs", "final.json"), "utf8")), {
    input: { message: "hello" },
    agent: "helper:say hi",
  });
});

void test("propose_workflow_tool_saves_draft_directory", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const workflowFile = path.join(project, ".pi", "workflows", "summarize", "workflow.js");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  const result = await tool.execute(
    "call-1",
    { name: "summarize", draftDir: path.relative(project, draftDir) },
    undefined,
    undefined,
    trustedToolContext,
  );

  assert.deepEqual(result.details, { workflowName: "summarize", saved: true });
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Saved workflow 'summarize'/);
  assert.equal((await readFile(workflowFile, "utf8")).trim(), source);
});

void test("propose_workflow_tool_copies_draft_directory_assets", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return renderPrompt("summary.txt", { prompt });
}`;
  await mkdir(path.join(draftDir, "prompts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(draftDir, "workflow.js"), source, "utf8"),
    writeFile(path.join(draftDir, "prompts", "summary.txt"), "Summarize {{prompt}}", "utf8"),
  ]);
  const workflowDir = path.join(project, ".pi", "workflows", "summarize");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await tool.execute("call-1", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, trustedToolContext);

  assert.equal((await readFile(path.join(workflowDir, "workflow.js"), "utf8")).trim(), source);
  assert.equal(await readFile(path.join(workflowDir, "prompts", "summary.txt"), "utf8"), "Summarize {{prompt}}");
});

void test("propose_workflow_tool_rejects_draft_directory_inside_published_workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  const draftDir = path.join(project, ".pi", "workflows", "summarize");
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, trustedToolContext),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose_workflow_tool_rejects_draft_directory_that_contains_published_workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const source = `${generatedWorkflowDocstring}export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(path.join(project, ".pi", "workflows"), { recursive: true });
  await writeFile(path.join(project, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-1", { name: "summarize", draftDir: "." }, undefined, undefined, trustedToolContext),
    /must not be inside, equal to, or an ancestor of \.pi\/workflows/,
  );
});

void test("propose_workflow_tool_rejects_draft_without_docstring", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-tool-"));
  const draftDir = path.join(project, ".pi", "workflow-drafts", "summarize");
  const source = `export const metadata = { name: "summarize", description: "Summarize files", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ prompt }) {
  return { prompt };
}`;
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.join(draftDir, "workflow.js"), source, "utf8");
  const tool = createWorkflowTools({ cwd: project }).find((candidate) => candidate.name === "propose_workflow");
  assert.ok(tool);

  await assert.rejects(
    tool.execute("call-2", { name: "summarize", draftDir: path.relative(project, draftDir) }, undefined, undefined, trustedToolContext),
    /must start with a JSDoc docstring/,
  );
});
