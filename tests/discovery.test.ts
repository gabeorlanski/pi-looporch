import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverWorkflows } from "../src/discovery.ts";

async function writeWorkflow(project: string, name: string, source: string): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
}

void test("discover_workflows_skips_invalid_workflow_sources", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  await writeWorkflow(
    project,
    "valid",
    `export const metadata = { name: "valid", description: "Valid workflow", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return "ok";
}`,
  );
  await writeWorkflow(
    project,
    "invalid",
    `import fs from "node:fs";
export const metadata = { name: "invalid", description: "Invalid workflow", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return fs.existsSync(".");
}`,
  );

  const workflows = await discoverWorkflows(project);

  assert.deepEqual(
    workflows.map((workflow) => workflow.name),
    ["valid"],
  );
});

void test("discover_workflows_allows_workflow_settings_without_workflow_dirs", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"workflow":{"maxParallelAgents":4}}\n', "utf8");
  await writeWorkflow(
    project,
    "valid",
    `export const metadata = { name: "valid", description: "Valid workflow", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return "ok";
}`,
  );

  const workflows = await discoverWorkflows(project);

  assert.deepEqual(
    workflows.map((workflow) => workflow.name),
    ["valid"],
  );
});

void test("discover_workflows_uses_configured_workflow_dirs_from_canonical_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  const sharedRoot = path.join(project, "shared-workflows");
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"workflow":{"workflowDirs":["shared-workflows"]}}\n', "utf8");
  await mkdir(path.join(sharedRoot, "shared"), { recursive: true });
  await writeFile(
    path.join(sharedRoot, "shared", "workflow.js"),
    `export const metadata = { name: "shared", description: "Shared workflow", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return "ok";
}`,
    "utf8",
  );

  const workflows = await discoverWorkflows(project);

  assert.deepEqual(
    workflows.map((workflow) => workflow.name),
    ["shared"],
  );
});
