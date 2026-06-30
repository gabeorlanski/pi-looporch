import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clearRunningWorkflowUi, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import type { WorkflowSnapshot } from "../src/runtime/types.ts";
import { registerActiveWorkflowRun, removeActiveWorkflowRun } from "../src/workflow/active-runs.ts";
import { writeWorkflowOutputManifest, writeWorkflowSnapshot } from "../src/workflow/outputs.ts";
import { createExtensionHarness, waitForCondition, writeProjectWorkflow } from "./extension-harness.ts";

void test("existing_workflow_command_runs_directly_with_progress_updates", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "echo",
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  phase("running");
  return input;
}`,
  );
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow", 'echo message=hello count=10 debug=true files=src/index.ts,tests/index.test.ts note="hello world"');

  assert.equal(harness.sentUserMessages.length, 0);
  assert.ok(harness.statusUpdates.includes("Waiting for 1 dynamic workflow to finish"));
  assert.equal(harness.widgetInstallCount(), 1);
  assert.equal(harness.widgetPlacement(), "belowEditor");
  await waitForCondition(() =>
    harness.widgetUpdates.some(
      (update) => update?.some((line) => line.includes("workflow echo")) && update.some((line) => line.includes("0/0 agents done")),
    ),
  );
  await waitForCondition(() => harness.sentMessages.length === 1 && harness.statusUpdates.at(-1) === undefined);
  assert.match(
    harness.sentMessages[0].message.content,
    /Workflow 'echo' complete\.\n\nWorkflow result: .*final\.json\n\nWorkflow session logs: /,
  );
  assert.doesNotMatch(harness.sentMessages[0].message.content, /hello world/);
});

void test("existing_workflow_command_does_not_report_success_notification_failure_as_workflow_failure", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "complete",
    `export const metadata = { name: "complete", description: "Complete workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { ok: true };
}`,
  );
  const harness = createExtensionHarness({
    cwd: project,
    sendMessage() {
      throw new Error("send failed");
    },
  });

  await harness.command("workflow", "complete");
  await waitForCondition(() =>
    harness.notifications.some((notification) => notification.message.includes("completed, but completion handling failed")),
  );

  assert.ok(harness.notifications.some((notification) => notification.message.includes("send failed") && notification.type === "error"));
  assert.ok(harness.notifications.every((notification) => !notification.message.includes("Workflow 'complete' failed")));
});

void test("registered_run_workflow_tool_shows_running_tui_widget", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "tool-echo",
    `export const metadata = { name: "tool-echo", description: "Echo input", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  phase("running");
  return input;
}`,
  );
  const harness = createExtensionHarness({ cwd: project });
  const tool = harness.tools.get("run_workflow");
  assert.ok(tool);

  const result = await tool.execute("call-1", { name: "tool-echo", input: { message: "hello" } }, undefined, undefined, harness.ctx);

  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Workflow tool-echo started in the background/);
  assert.ok(harness.statusUpdates.includes("Waiting for 1 dynamic workflow to finish"));
  assert.equal(harness.widgetInstallCount(), 1);
  assert.equal(harness.widgetPlacement(), "belowEditor");
  assert.ok(
    harness.widgetUpdates.some(
      (update) => update?.some((line) => line.includes("workflow tool-echo")) && update.some((line) => line.includes("0/0 agents done")),
    ),
  );
  await waitForCondition(() => harness.notifications.some((notification) => notification.message.includes("Workflow tool-echo complete")));
  await waitForCondition(() => harness.statusUpdates.at(-1) === undefined);
});

void test("view_workflow_command_opens_running_workflow_inspector", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  const launchCtx = { ...harness.ctx };
  updateRunningWorkflowUi(launchCtx, {
    runId: "run-view",
    snapshot: runningWorkflowSnapshot(),
    abortWorkflow: () => undefined,
  });

  const command = harness.command("view-workflow", "");
  await waitForCondition(() => harness.customOpenCount() === 1);

  assert.ok(harness.customUpdates.some((update) => update.some((line) => line.includes("workflow viewable"))));
  harness.closeCustom();
  await command;
  clearRunningWorkflowUi(launchCtx, "run-view");
});

void test("session_start_restores_running_workflow_widget_from_active_registry", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "reloadable-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-reloadable",
    workflowName: "reloadable",
    outputsDir,
    startedAt: Date.now(),
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "reloadable",
    status: "running",
    snapshot: runningWorkflowSnapshot("reloadable"),
  });
  await writeWorkflowSnapshot(outputsDir, runningWorkflowSnapshot("reloadable"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.sessionStart("reload");

  assert.equal(harness.widgetInstallCount(), 1);
  assert.ok(harness.widgetUpdates.some((update) => update?.some((line) => line.includes("workflow reloadable"))));
  const command = harness.command("view-workflow", "");
  await waitForCondition(() => harness.customOpenCount() === 1);
  assert.ok(harness.customUpdates.some((update) => update.some((line) => line.includes("workflow reloadable"))));
  harness.closeCustom();
  await command;
  clearRunningWorkflowUi(harness.ctx, "run-reloadable");
  await removeActiveWorkflowRun(project, "run-reloadable");
});

void test("view_workflow_command_warns_when_no_workflow_is_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("view-workflow", "");

  assert.deepEqual(harness.notifications.at(-1), { message: "No running workflows to view.", type: "warning" });
  assert.equal(harness.customOpenCount(), 0);
});

void test("workflow_settings_command_writes_project_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow-settings", "maxParallelAgents=8");

  assert.match(harness.notifications.at(-1)?.message ?? "", /set to 8/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")), {
    workflow: { maxParallelAgents: 8 },
  });

  await harness.command("workflow-settings", "childAgentExtensions=pi-subagents,./extensions/todo.ts");

  assert.match(harness.notifications.at(-1)?.message ?? "", /child agent extensions set/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")), {
    workflow: { maxParallelAgents: 8, childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"] },
  });
});

void test("workflow_settings_command_shows_readable_current_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow-settings", "");

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].message.display, true);
  assert.deepEqual((harness.sentMessages[0].message.details as { kind?: string }).kind, "workflow-settings");
  assert.match(harness.sentMessages[0].message.content, /# Workflow Settings/);
  assert.match(harness.sentMessages[0].message.content, /Max parallel agents: 4/);
  assert.match(harness.sentMessages[0].message.content, /Project: \.pi\/settings\.json/);
  assert.match(harness.sentMessages[0].message.content, /\/workflow-settings maxParallelAgents=8/);
});

void test("existing_workflow_freeform_input_is_steered_in_current_session", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "echo",
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Treat bare text as the message field.", phases: [{ title: "Run" }] };
/**
 * Input: input.message is the text to echo.
 * Phase: returns immediately.
 * Agent: launches no child agents.
 * Result: returns the input.
 * @param {object} input
 * @param {string} input.message - Text to echo.
 */
export default async function workflow({ message }) {
  return { message };
}`,
  );
  const harness = createExtensionHarness({ cwd: project, idle: false });

  await harness.command("workflow", "echo hello from natural language");

  assert.deepEqual(harness.sentUserMessages, []);
  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(harness.sentMessages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(harness.sentMessages[0].message.display, true);
  assert.deepEqual(harness.sentMessages[0].message.details, { kind: "workflow-agent-prompt" });
  assert.match(harness.sentMessages[0].message.content, /Resolve input for workflow 'echo'/);
  assert.match(harness.sentMessages[0].message.content, /call run_workflow/);
  assert.match(harness.sentMessages[0].message.content, /MUST try to resolve clear ambiguities/);
  assert.match(harness.sentMessages[0].message.content, /Ask a concise clarification question only when required input remains unknowable/);
  assert.match(harness.sentMessages[0].message.content, /Treat bare text as the message field/);
  assert.match(harness.sentMessages[0].message.content, /input\.message/);
  assert.doesNotMatch(harness.sentMessages[0].message.content, /workflow\.js, for secondary context only/);
  assert.doesNotMatch(harness.sentMessages[0].message.content, /return \{ message \};/);
});

void test("existing_workflow_command_reports_missing_required_input_without_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "plan",
    `export const metadata = { name: "plan", description: "Plan fixes", inputInstructions: "Resolve repo and problem from command input.", phases: [{ title: "Run" }] };
/**
 * Input: repo and problem are required. mode defaults to fast.
 * Phase: runs a planning phase.
 * Agent: launches one planning agent.
 * Result: returns the plan.
 * @param {object} input
 * @param {string} input.repo - Repository path.
 * @param {string} input.problem - Problem description.
 * @param {string} [input.mode=fast] - Planning depth.
 */
export default async function workflow({ repo, problem, mode = "fast" }) {
  phase("planning");
  return { repo, problem, mode };
}`,
  );
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow", "plan repo=owner/name");

  assert.equal(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0].message.content, /missing required input: problem/);
  assert.match(harness.sentMessages[0].message.content, /problem=<value>/);
  assert.equal(harness.notifications.at(-1)?.type, "warning");
});

function runningWorkflowSnapshot(workflowName = "viewable"): WorkflowSnapshot {
  return {
    workflowName,
    description: "Visible workflow",
    plannedPhases: [{ title: "Run" }],
    phases: ["running"],
    traces: [],
    agents: [],
    fanOuts: [],
    messages: [],
    status: "running",
  };
}
