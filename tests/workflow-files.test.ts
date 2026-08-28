import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderWorkflowAgentTask, renderWorkflowPrompt } from "../src/runtime/prompts.ts";
import { readWorkflowJson, readWorkflowText, writeWorkflowJson, writeWorkflowText } from "../src/workflow/files.ts";

void test("workflow file helpers preserve project, workflow, and absolute paths", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-files-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", "review");
  const externalDirectory = await mkdtemp(path.join(tmpdir(), "pi-workflow-external-"));
  const absolutePath = path.join(externalDirectory, "absolute.txt");

  const projectPath = writeWorkflowText(project, workflowDirectory, "artifacts/report.txt", "project output");
  const workflowPath = writeWorkflowJson(project, workflowDirectory, "@workflow/generated/result.json", { ok: true, count: 2 });
  const writtenAbsolutePath = writeWorkflowText(project, workflowDirectory, absolutePath, "absolute output");

  assert.equal(projectPath, path.join(project, "artifacts", "report.txt"));
  assert.equal(workflowPath, path.join(workflowDirectory, "generated", "result.json"));
  assert.equal(writtenAbsolutePath, absolutePath);
  assert.equal(readWorkflowText(project, workflowDirectory, "artifacts/report.txt"), "project output");
  assert.deepEqual(readWorkflowJson(project, workflowDirectory, "@workflow/generated/result.json"), { ok: true, count: 2 });
  assert.equal(await readFile(absolutePath, "utf8"), "absolute output");
});

void test("workflow prompts stay inside their own prompt directory", async () => {
  const workflowDirectory = await mkdtemp(path.join(tmpdir(), "pi-workflow-prompts-"));
  await mkdir(path.join(workflowDirectory, "prompts"));
  await Promise.all([
    writeFile(path.join(workflowDirectory, "prompts", "review.txt"), "Review {{file}} for {{focus}}.", "utf8"),
    writeFile(path.join(workflowDirectory, "secret.txt"), "secret", "utf8"),
  ]);

  assert.equal(
    renderWorkflowPrompt(workflowDirectory, "review.txt", { file: "src/index.ts", focus: "edge cases" }),
    "Review src/index.ts for edge cases.",
  );
  assert.equal(
    renderWorkflowAgentTask(workflowDirectory, { template: "review.txt", values: { file: "src/index.ts", focus: "correctness" } }),
    "Review src/index.ts for correctness.",
  );
  assert.throws(
    () => renderWorkflowAgentTask(workflowDirectory, { template: "review.txt", values: { file: "src/index.ts" } }),
    /missing value 'focus'/,
  );
  assert.throws(() => renderWorkflowPrompt(workflowDirectory, "../secret.txt", {}), /escapes workflow prompt directory/);
});
