import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
