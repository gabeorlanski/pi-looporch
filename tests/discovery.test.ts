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

void test("discovery skips workflows with invalid literal structured schemas", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  await writeWorkflow(
    project,
    "invalid-schema",
    `export const metadata = { name: "invalid-schema", description: "Invalid schema", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { schema: { type: "string", pattern: "[" } });
}`,
  );
  assert.deepEqual(await discoverWorkflows(project), []);
});

void test("discovery validates a global agent outside a nested shadow", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  await writeWorkflow(
    project,
    "nested-shadow",
    `export const metadata = { name: "nested-shadow", description: "Nested shadow", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  function local() { const agent = () => undefined; return agent(); }
  local();
  return agent("work", { schema: { type: "string", pattern: "[" } });
}`,
  );
  assert.deepEqual(await discoverWorkflows(project), []);
});

void test("discovery accepts static boolean schemas", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-discovery-"));
  await writeWorkflow(
    project,
    "boolean-schema",
    `export const metadata = { name: "boolean-schema", description: "Boolean schema", inputInstructions: "Use input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return agent("work", { schema: true });
}`,
  );
  assert.deepEqual(
    (await discoverWorkflows(project)).map((workflow) => workflow.name),
    ["boolean-schema"],
  );
});

void test("discovery allows settings without workflow directories", async () => {
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

void test("discovery uses configured workflow directories", async () => {
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
