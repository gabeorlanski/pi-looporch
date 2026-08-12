import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_MAX_PARALLEL_AGENTS,
  readWorkflowSettings,
  writeGlobalWorkflowSettings,
  writeProjectWorkflowSettings,
} from "../src/workflow/settings.ts";

void test("workflow_settings_default_agent_capabilities_to_all", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-agent-"));

  assert.deepEqual(await readWorkflowSettings(project, agentDir), {
    workflowDirs: [],
    maxParallelAgents: DEFAULT_MAX_PARALLEL_AGENTS,
    childAgentExtensions: "all",
    childAgentTools: "all",
  });
});

void test("workflow_settings_read_and_write_project_settings_json", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-agent-"));
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"theme":"dark","workflow":{"other":true}}\n', "utf8");

  await writeProjectWorkflowSettings(project, {
    maxParallelAgents: 8,
    childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"],
    childAgentTools: [],
  });

  const rawSettings = JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")) as unknown;
  assert.deepEqual(rawSettings, {
    theme: "dark",
    workflow: {
      other: true,
      maxParallelAgents: 8,
      childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"],
      childAgentTools: [],
    },
  });
  assert.deepEqual(await readWorkflowSettings(project, agentDir), {
    workflowDirs: [],
    maxParallelAgents: 8,
    childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"],
    childAgentTools: [],
  });
});

void test("workflow_settings_merge_global_and_project_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-project-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-agent-"));

  await writeGlobalWorkflowSettings(agentDir, {
    maxParallelAgents: 6,
    childAgentExtensions: ["pi-subagents"],
    childAgentTools: ["read", "bash"],
  });
  await writeProjectWorkflowSettings(project, { maxParallelAgents: 2, childAgentTools: [] });

  assert.deepEqual(await readWorkflowSettings(project, agentDir), {
    workflowDirs: [],
    maxParallelAgents: 2,
    childAgentExtensions: ["pi-subagents"],
    childAgentTools: [],
  });
});

void test("workflow_settings_reject_invalid_parallel_cap", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-agent-"));
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await writeFile(path.join(project, ".pi", "settings.json"), '{"workflow":{"maxParallelAgents":0}}\n', "utf8");

  await assert.rejects(readWorkflowSettings(project, agentDir), /workflow\.maxParallelAgents must be a positive integer/);
});

void test("workflow_settings_reject_invalid_child_agent_capabilities", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-agent-"));
  for (const [field, value] of [
    ["childAgentExtensions", [""]],
    ["childAgentTools", "read"],
  ] as const) {
    const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-settings-"));
    await mkdir(path.join(project, ".pi"), { recursive: true });
    await writeFile(path.join(project, ".pi", "settings.json"), `${JSON.stringify({ workflow: { [field]: value } })}\n`, "utf8");
    await assert.rejects(
      readWorkflowSettings(project, agentDir),
      new RegExp(`workflow\\.${field} must be "all" or an array of non-empty strings`),
    );
  }
});
