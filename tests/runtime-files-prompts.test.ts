import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { WorkflowAgent } from "../src/runtime/types.ts";
import { runWorkflowFromDirectory } from "../src/runtime/run.ts";
import { writeWorkflow } from "./runtime-helpers.ts";

void test("workflow_renders_project_prompt_template", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "templated",
    `export const metadata = { name: "templated", description: "Templated prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ file, focus }) {
  return agent(renderPrompt("review.txt", { file, focus }), { label: "review" });
}`,
    { "prompts/review.txt": "Review {{file}} for {{focus}}." },
  );
  const agent: WorkflowAgent = (prompt, options) => Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "templated",
    input: { file: "src/index.ts", focus: "edge cases" },
    agent,
  });

  assert.equal(result.result, "review:Review src/index.ts for edge cases.");
});

void test("workflow_renders_prompt_template_from_external_workflow_root", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const workflowRoot = await mkdtemp(path.join(tmpdir(), "pi-workflow-root-"));
  const workflowDir = path.join(workflowRoot, "external-prompt");
  await mkdir(path.join(workflowDir, "prompts", "review"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "external-prompt", description: "External prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ topic }) {
  return renderPrompt("review/base.txt", { topic });
}`,
    "utf8",
  );
  await writeFile(path.join(workflowDir, "prompts", "review", "base.txt"), "External {{topic}} prompt.", "utf8");
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "external-prompt",
    input: { topic: "template" },
    agent,
    workflowRoots: [workflowRoot],
  });

  assert.equal(result.result, "External template prompt.");
});

void test("workflow_writes_text_and_json_files", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const outside = await mkdtemp(path.join(tmpdir(), "pi-workflow-writable-"));
  const absolutePath = path.join(outside, "absolute.txt");
  await writeWorkflow(
    project,
    "write-files",
    `export const metadata = { name: "write-files", description: "Write files", inputInstructions: "Use provided paths.", phases: [{ title: "Run" }] };
export default async function workflow({ absolutePath }) {
  const textPath = writeText("artifacts/report.txt", "hello");
  const jsonPath = writeJson("@workflow/generated/result.json", { ok: true, nested: { count: 2 } });
  const absoluteWrittenPath = writeText(absolutePath, "absolute");
  return {
    textPath,
    jsonPath,
    absoluteWrittenPath,
    text: readText("artifacts/report.txt"),
    json: readJson("@workflow/generated/result.json"),
    absoluteText: readText(absolutePath),
  };
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  const result = await runWorkflowFromDirectory({
    maxParallelAgents: 4,
    cwd: project,
    workflowName: "write-files",
    input: { absolutePath },
    agent,
  });
  const textPath = path.join(project, "artifacts", "report.txt");
  const jsonPath = path.join(project, ".pi", "workflows", "write-files", "generated", "result.json");

  assert.deepEqual(result.result, {
    textPath,
    jsonPath,
    absoluteWrittenPath: absolutePath,
    text: "hello",
    json: { ok: true, nested: { count: 2 } },
    absoluteText: "absolute",
  });
  assert.equal(await readFile(textPath, "utf8"), "hello");
  assert.equal(await readFile(jsonPath, "utf8"), '{\n  "ok": true,\n  "nested": {\n    "count": 2\n  }\n}\n');
});

void test("workflow_write_text_requires_string_content", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "bad-write",
    `export const metadata = { name: "bad-write", description: "Bad write", inputInstructions: "No input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return writeText("out.txt", { bad: true });
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "bad-write", input: {}, agent }),
    /writeText content must be a string/,
  );
});

void test("workflow_does_not_read_legacy_sibling_prompt_template", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await mkdir(path.join(project, ".pi", "workflows", "legacy.prompts"), { recursive: true });
  await writeFile(path.join(project, ".pi", "workflows", "legacy.prompts", "review.txt"), "Legacy {{topic}} prompt.", "utf8");
  await writeWorkflow(
    project,
    "legacy",
    `export const metadata = { name: "legacy", description: "Legacy prompt", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow({ topic }) {
  return renderPrompt("review.txt", { topic });
}`,
  );
  const agent: WorkflowAgent = () => Promise.resolve("unused");

  await assert.rejects(
    runWorkflowFromDirectory({ maxParallelAgents: 4, cwd: project, workflowName: "legacy", input: { topic: "template" }, agent }),
    /Prompt template not found: review\.txt/,
  );
});
