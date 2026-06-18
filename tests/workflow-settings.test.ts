import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_MAX_PARALLEL_AGENTS, readProjectWorkflowSettings, writeProjectWorkflowSettings } from "../src/workflow-settings.ts";

void test("workflow_settings_default_to_four_parallel_agents", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));

  assert.deepEqual(await readProjectWorkflowSettings(project), { maxParallelAgents: DEFAULT_MAX_PARALLEL_AGENTS });
});

void test("workflow_settings_read_and_write_project_settings_json", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"theme":"dark","workflow":{"other":true}}\n', "utf8");

  await writeProjectWorkflowSettings(project, { maxParallelAgents: 8 });

  const rawSettings = JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")) as unknown;
  assert.deepEqual(rawSettings, { theme: "dark", workflow: { other: true, maxParallelAgents: 8 } });
  assert.deepEqual(await readProjectWorkflowSettings(project), { maxParallelAgents: 8 });
});

void test("workflow_settings_reject_invalid_parallel_cap", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"workflow":{"maxParallelAgents":0}}\n', "utf8");

  await assert.rejects(readProjectWorkflowSettings(project), /workflow\.maxParallelAgents must be a positive integer/);
});
