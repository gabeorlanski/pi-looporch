import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clearRunningWorkflowUi, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import { startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import type { WorkflowAgent, WorkflowSnapshot } from "../src/runtime/types.ts";
import { readActiveWorkflowRuns, registerActiveWorkflowRun, removeActiveWorkflowRun } from "../src/workflow/active-runs.ts";
import { writeWorkflowOutputManifest, writeWorkflowSnapshot } from "../src/workflow/outputs.ts";
import { createExtensionHarness, type ExtensionHarness, waitForCondition, writeProjectWorkflow } from "./extension-harness.ts";

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

  assert.equal(harness.widgetInstallCount(), 1);
  assert.equal(harness.widgetPlacement(), "belowEditor");
  await waitForCondition(() =>
    harness.widgetUpdates.some(
      (update) => update?.some((line) => line.includes("workflow echo")) && update.some((line) => line.includes("0/0 agents done")),
    ),
  );
});

void test("existing_workflow_completion_sends_automated_user_message", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "echo",
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  return input;
}`,
  );
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow", "echo message=hello");
  const handoff = await waitForOnlyUserTextMessage(harness);

  assert.deepEqual(handoff.options, undefined);
  assert.match(handoff.text, /Automated workflow completion handoff: workflow 'echo' completed/);
  assert.ok(handoff.text.includes('Result:\n\n```json\n{\n  "message": "hello"\n}'));
  assert.match(handoff.text, /Paths:\n- Workflow result: .*final\.json/);
  assert.ok(harness.notifications.some((entry) => entry.message === "Workflow 'echo' complete." && entry.type === "info"));
  assert.deepEqual(JSON.parse(await readFile(workflowResultPathFrom(handoff.text), "utf8")), { message: "hello" });
});

void test("workflow completion follows up when busy", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "busy-complete",
    `export const metadata = { name: "busy-complete", description: "Complete workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { ok: true };
}`,
  );
  const harness = createExtensionHarness({ cwd: project, idle: false });

  await harness.command("workflow", "busy-complete");
  const handoff = await waitForOnlyUserTextMessage(harness);

  assert.deepEqual(handoff.options, { deliverAs: "followUp" });
  assert.match(handoff.text, /Automated workflow completion handoff/);
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
  assert.equal(harness.widgetInstallCount(), 1);
  assert.equal(harness.widgetPlacement(), "belowEditor");
  assert.ok(
    harness.widgetUpdates.some(
      (update) => update?.some((line) => line.includes("workflow tool-echo")) && update.some((line) => line.includes("0/0 agents done")),
    ),
  );
  await waitForCondition(() => harness.sentUserMessages.length === 1);
  assert.deepEqual(harness.notifications.at(-1), { message: "Workflow 'tool-echo' complete.", type: "info" });
  assert.equal(harness.sentMessages.length, 0);
  const handoff = harness.sentUserMessages[0];
  assert.deepEqual(handoff.options, undefined);
  assert.match(
    typeof handoff.message === "string" ? handoff.message : "",
    /Automated workflow completion handoff: workflow 'tool-echo' completed/,
  );
  assert.match(typeof handoff.message === "string" ? handoff.message : "", /"message": "hello"/);
});

void test("workflow_status_tool_reads_project_wide_active_runs", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const olderOutputsDir = path.join(project, "outputs", "older-status-run");
  const outputsDir = path.join(project, "outputs", "status-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-older-status",
    workflowName: "older-status",
    outputsDir: olderOutputsDir,
    startedAt: Date.now() - 180_000,
    ownerSessionId: "other-session",
  });
  await writeWorkflowOutputManifest({
    outputsDir: olderOutputsDir,
    workflowName: "older-status",
    status: "running",
    snapshot: monitorWorkflowSnapshot("older-status"),
  });
  await writeWorkflowSnapshot(olderOutputsDir, monitorWorkflowSnapshot("older-status"));
  await registerActiveWorkflowRun(project, {
    runId: "run-status",
    workflowName: "status-check",
    outputsDir,
    startedAt: Date.now() - 90_000,
    ownerSessionId: "other-session",
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "status-check",
    status: "running",
    snapshot: monitorWorkflowSnapshot("status-check"),
  });
  await writeWorkflowSnapshot(outputsDir, monitorWorkflowSnapshot("status-check"));
  const harness = createExtensionHarness({ cwd: project, sessionId: "current-session" });
  const tool = harness.tools.get("workflow_status");
  assert.ok(tool);

  const result = await tool.execute("call-1", {}, undefined, undefined, harness.ctx);

  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /status-check running · phase: Review broken tests · 1\/2 agents done/);
  assert.match(text, /broken-test reviews: 1\/2 done, 1 running, 0 errors/);
  assert.match(text, /#2 review broken tests clirs 05_onboard/);
  assert.equal((result.details as { ownerSessionId?: string }).ownerSessionId, "other-session");
  assert.equal((result.details as { workflowName?: string }).workflowName, "status-check");

  const currentSession = await tool.execute("call-2", { scope: "current-session" }, undefined, undefined, harness.ctx);

  assert.equal(
    currentSession.content[0]?.type === "text" ? currentSession.content[0].text : "",
    "No active workflows in this current session.",
  );
  await removeActiveWorkflowRun(project, "run-status");
  await removeActiveWorkflowRun(project, "run-older-status");
});

void test("workflow_status_tool_degrades_when_snapshot_is_unavailable", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "missing-snapshot-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-missing-snapshot",
    workflowName: "missing-snapshot",
    outputsDir,
    startedAt: Date.now(),
    ownerSessionId: "test-session",
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "missing-snapshot",
    status: "running",
  });
  const harness = createExtensionHarness({ cwd: project });
  const tool = harness.tools.get("workflow_status");
  assert.ok(tool);

  const result = await tool.execute("call-1", {}, undefined, undefined, harness.ctx);

  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /missing-snapshot running · phase: snapshot unavailable/);
  assert.match(text, /Snapshot unavailable\./);
  assert.equal((result.details as { snapshotAvailable?: boolean }).snapshotAvailable, false);
  assert.match((result.details as { errors: string[] }).errors[0] ?? "", /ENOENT|no such file or directory/);
  await removeActiveWorkflowRun(project, "run-missing-snapshot");
});

void test("workflow_status_command_rejects_multiple_refs", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow-status", "latest other-ref");

  assert.deepEqual(harness.notifications.at(-1), {
    message: "Usage: /workflow-status [--json] [--all] [latest|<run-id>|<workflow>|<outputsDir>]",
    type: "error",
  });
});

void test("session shutdown aborts visible workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "slow",
    `export const metadata = { name: "slow", description: "Slow workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  await agent("wait", { label: "slow child" });
  return { ok: true };
}`,
  );
  const harness = createExtensionHarness({ cwd: project });
  let childStarted = false;
  let childAbortSeen = false;
  const agent: WorkflowAgent = (_prompt, options) =>
    new Promise((_resolve, reject) => {
      childStarted = true;
      options.signal?.addEventListener(
        "abort",
        () => {
          childAbortSeen = true;
          reject(new Error("child aborted"));
        },
        { once: true },
      );
    });
  const visible = await startVisibleWorkflowRun({
    ctx: harness.ctx,
    cwd: project,
    workflowName: "slow",
    input: {},
    agentDir: path.join(project, "agent-dir"),
    agent,
    sendUserMessage: () => undefined,
  });

  await waitForCondition(() => childStarted);
  await harness.sessionShutdown();

  await assert.rejects(visible.run.finished, /child aborted/);
  assert.equal(childAbortSeen, true);
  assert.deepEqual(await readActiveWorkflowRuns(project), []);
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

void test("session start restores the running workflow widget", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "reloadable-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-reloadable",
    workflowName: "reloadable",
    outputsDir,
    startedAt: Date.now(),
    ownerSessionId: "test-session",
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

void test("session_start_removes_active_workflow_from_dead_process", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "dead-process-run");
  await mkdir(path.join(project, ".pi", "workflow-runs", "active"), { recursive: true });
  await writeFile(
    path.join(project, ".pi", "workflow-runs", "active", "run-dead-process.json"),
    `${JSON.stringify({
      runId: "run-dead-process",
      workflowName: "dead-process",
      outputsDir,
      startedAt: Date.now(),
      ownerSessionId: "test-session",
      ownerProcessId: -1,
    })}\n`,
    "utf8",
  );
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "dead-process",
    status: "running",
    snapshot: runningWorkflowSnapshot("dead-process"),
  });
  await writeWorkflowSnapshot(outputsDir, runningWorkflowSnapshot("dead-process"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.sessionStart("reload");

  assert.equal(harness.widgetInstallCount(), 0);
  assert.deepEqual(await readActiveWorkflowRuns(project), []);
});

void test("session start ignores workflows from other sessions", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "other-session-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-other-session",
    workflowName: "other-session",
    outputsDir,
    startedAt: Date.now(),
    ownerSessionId: "other-session",
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "other-session",
    status: "running",
    snapshot: runningWorkflowSnapshot("other-session"),
  });
  await writeWorkflowSnapshot(outputsDir, runningWorkflowSnapshot("other-session"));
  const harness = createExtensionHarness({ cwd: project, sessionId: "current-session" });

  await harness.sessionStart("reload");

  assert.equal(harness.widgetInstallCount(), 0);
  await harness.command("view-workflow", "");
  assert.deepEqual(harness.notifications.at(-1), { message: "No running workflows to view.", type: "warning" });
  await removeActiveWorkflowRun(project, "run-other-session");
});

void test("session start shows the other-session monitor", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const outputsDir = path.join(project, "outputs", "project-monitor-run");
  await registerActiveWorkflowRun(project, {
    runId: "run-project-monitor",
    workflowName: "project-monitor",
    outputsDir,
    startedAt: Date.now() - 120_000,
    ownerSessionId: "other-session",
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: "project-monitor",
    status: "running",
    snapshot: monitorWorkflowSnapshot("project-monitor"),
  });
  await writeWorkflowSnapshot(outputsDir, monitorWorkflowSnapshot("project-monitor"));
  const harness = createExtensionHarness({ cwd: project, sessionId: "current-session" });

  await harness.sessionStart("reload");

  await waitForCondition(() =>
    harness
      .widgetUpdatesFor("workflow-monitor")
      .some((update) => update?.some((line) => line.includes("project-monitor · other session · Review broken tests"))),
  );
  assert.equal(harness.widgetPlacementFor("workflow-monitor"), "belowEditor");
  assert.equal(harness.widgetInstallCount(), 0);
  await harness.sessionShutdown();
  await removeActiveWorkflowRun(project, "run-project-monitor");
});

void test("project monitor lists active other-session workflows", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const names = ["project-monitor-a", "project-monitor-b", "project-monitor-c", "project-monitor-d", "project-monitor-e"];
  await Promise.all(
    names.map((name, index) =>
      writeMonitorRun(project, {
        runId: `run-${name}`,
        workflowName: name,
        ownerSessionId: index === 0 ? "current-session" : "other-session",
        startedAt: Date.now() - index * 1000,
      }),
    ),
  );
  const harness = createExtensionHarness({ cwd: project, sessionId: "current-session" });

  await harness.sessionStart("reload");

  await waitForCondition(() =>
    harness
      .widgetUpdatesFor("workflow-monitor")
      .some(
        (update) =>
          update?.some((line) => line.includes("4 workflows active")) &&
          !update.some((line) => line.includes(names[0])) &&
          names.slice(1).every((name) => update.some((line) => line.includes(name))),
      ),
  );
  await harness.sessionShutdown();
  await Promise.all(names.map((name) => removeActiveWorkflowRun(project, `run-${name}`)));
});

void test("monitor timer stops before a session is replaced", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"], now: Date.now() });
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeMonitorRun(project, {
    runId: "run-replaced-session",
    workflowName: "replaced-session",
    ownerSessionId: "other-session",
    startedAt: Date.now(),
  });
  const harness = createExtensionHarness({ cwd: project, sessionId: "current-session" });

  await harness.sessionStart("reload");
  await waitForCondition(() =>
    harness.widgetUpdatesFor("workflow-monitor").some((update) => update?.some((line) => line.includes("replaced-session"))),
  );
  const updatesBeforeReplace = harness.widgetUpdatesFor("workflow-monitor").length;

  await harness.sessionShutdown("new");
  harness.replaceSession();
  t.mock.timers.tick(3000);
  await Promise.resolve();

  assert.equal(harness.widgetUpdatesFor("workflow-monitor").length, updatesBeforeReplace + 1);
  await removeActiveWorkflowRun(project, "run-replaced-session");
});

void test("view workflow ignores another session's run", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const ownerHarness = createExtensionHarness({ cwd: project, sessionId: "owner-session" });
  const viewerHarness = createExtensionHarness({ cwd: project, sessionId: "viewer-session" });

  updateRunningWorkflowUi(ownerHarness.ctx, {
    runId: "run-owner",
    snapshot: runningWorkflowSnapshot("owner-workflow"),
    abortWorkflow: () => undefined,
  });

  await viewerHarness.command("view-workflow", "");

  assert.equal(viewerHarness.customOpenCount(), 0);
  assert.deepEqual(viewerHarness.notifications.at(-1), { message: "No running workflows to view.", type: "warning" });
  clearRunningWorkflowUi(ownerHarness.ctx, "run-owner");
});

void test("view_workflow_command_warns_when_no_workflow_is_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("view-workflow", "");

  assert.deepEqual(harness.notifications.at(-1), { message: "No running workflows to view.", type: "warning" });
  assert.equal(harness.customOpenCount(), 0);
});

void test("workflow command reports background failure", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  await writeProjectWorkflow(
    project,
    "fail",
    `export const metadata = { name: "fail", description: "Fail workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  throw new Error("workflow exploded");
}`,
  );
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow", "fail");
  await waitForCondition(() => harness.sentUserMessages.length === 1);

  assert.deepEqual(harness.notifications.at(-1), { message: "Workflow 'fail' failed: workflow exploded", type: "error" });
  assert.deepEqual(harness.sentMessages, []);
  assert.deepEqual(harness.sentUserMessages[0], { message: "Workflow 'fail' failed: workflow exploded", options: undefined });
  assert.equal(harness.widgetUpdates.at(-1), undefined);
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

  await harness.command("workflow-settings", "workflowDirs=../shared-workflows,.pi/team-workflows");

  assert.match(harness.notifications.at(-1)?.message ?? "", /Workflow directories set/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")), {
    workflow: {
      maxParallelAgents: 8,
      childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"],
      workflowDirs: ["../shared-workflows", ".pi/team-workflows"],
    },
  });
});

void test("workflow_settings_command_rejects_hidden_aliases", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });
  const aliases = [
    "8",
    "maxParallel=8",
    "childExtensions=pi-subagents",
    "extensions=pi-subagents",
    "dirs=../shared-workflows",
    "global maxParallelAgents=8",
    "scope=global maxParallelAgents=8",
  ];

  for (const alias of aliases) {
    await harness.command("workflow-settings", alias);
    assert.match(harness.notifications.at(-1)?.message ?? "", /^Usage: \/workflow-settings/);
    assert.equal(harness.notifications.at(-1)?.type, "error");
  }
});

void test("workflow_settings_command_shows_readable_current_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const harness = createExtensionHarness({ cwd: project });

  await harness.command("workflow-settings", "");

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].message.display, true);
  assert.deepEqual((harness.sentMessages[0].message.details as { kind?: string }).kind, "workflow-settings");
  assert.match(harness.sentMessages[0].message.content, /# Workflow Settings/);
  assert.match(harness.sentMessages[0].message.content, /Workflow directories: none/);
  assert.match(harness.sentMessages[0].message.content, /Max parallel agents: 4/);
  assert.match(harness.sentMessages[0].message.content, /Project: \.pi\/settings\.json/);
  assert.match(harness.sentMessages[0].message.content, /\/workflow-settings maxParallelAgents=8/);
  assert.match(harness.sentMessages[0].message.content, /\/workflow-settings workflowDirs=/);
});

void test("workflow command steers freeform input", async () => {
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

  const promptMessage = await waitForOnlyUserTextMessage(harness);

  assert.deepEqual(promptMessage.options, { deliverAs: "followUp" });
  const prompt = promptMessage.text;
  assert.match(prompt, /Resolve input for workflow 'echo'/);
  assert.match(prompt, /call run_workflow/);
  assert.match(prompt, /MUST try to resolve clear ambiguities/);
  assert.match(prompt, /Ask a concise clarification question only when required input remains unknowable/);
  assert.match(prompt, /Treat bare text as the message field/);
  assert.match(prompt, /input\.message/);
  assert.doesNotMatch(prompt, /workflow\.js, for secondary context only/);
  assert.doesNotMatch(prompt, /return \{ message \};/);
});

void test("workflow command reports missing required input", async () => {
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

  assert.deepEqual(harness.sentMessages, []);
  assert.equal(harness.sentUserMessages.length, 1);
  assert.match(
    typeof harness.sentUserMessages[0].message === "string" ? harness.sentUserMessages[0].message : "",
    /missing required input: problem/,
  );
  assert.match(typeof harness.sentUserMessages[0].message === "string" ? harness.sentUserMessages[0].message : "", /problem=<value>/);
  assert.equal(harness.notifications.at(-1)?.type, "warning");
});

async function waitForOnlyUserTextMessage(harness: ExtensionHarness): Promise<{ text: string; options: unknown }> {
  await waitForCondition(() => harness.sentUserMessages.length === 1);
  assert.deepEqual(harness.sentMessages, []);
  const sent = harness.sentUserMessages[0];
  if (typeof sent.message !== "string") throw new TypeError("expected one text user message");
  return { text: sent.message, options: sent.options };
}

function workflowResultPathFrom(text: string): string {
  const resultPath = /Workflow result: (.*final\.json)/.exec(text)?.[1];
  assert.ok(resultPath);
  return resultPath;
}

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

function monitorWorkflowSnapshot(workflowName: string): WorkflowSnapshot {
  const now = Date.now();
  return {
    workflowName,
    description: "Monitor workflow",
    plannedPhases: [{ title: "Collect" }, { title: "Review broken tests" }],
    phases: ["Collect", "Review broken tests"],
    traces: [],
    agents: [
      {
        id: 1,
        label: "collect failing tests",
        phaseIndex: 0,
        phase: "Collect",
        status: "done",
        startedAt: now - 60_000,
        endedAt: now - 30_000,
        inputTokenCount: 1000,
        outputTokenCount: 200,
        toolCallCount: 2,
        stepCount: 4,
      },
      {
        id: 2,
        label: "review broken tests clirs 05_onboard",
        phaseIndex: 1,
        phase: "Review broken tests",
        model: "default",
        reasoning: "high",
        status: "running",
        startedAt: now - 20_000,
        inputTokenCount: 16_000,
        outputTokenCount: 2300,
        toolCallCount: 4,
        stepCount: 8,
      },
    ],
    fanOuts: [{ id: 1, label: "broken-test reviews", total: 2, done: 1, running: 1, error: 0 }],
    messages: [],
    status: "running",
  };
}

async function writeMonitorRun(
  project: string,
  options: { runId: string; workflowName: string; ownerSessionId: string; startedAt: number },
): Promise<void> {
  const outputsDir = path.join(project, "outputs", options.runId);
  await registerActiveWorkflowRun(project, {
    runId: options.runId,
    workflowName: options.workflowName,
    outputsDir,
    startedAt: options.startedAt,
    ownerSessionId: options.ownerSessionId,
  });
  await writeWorkflowOutputManifest({
    outputsDir,
    workflowName: options.workflowName,
    status: "running",
    snapshot: monitorWorkflowSnapshot(options.workflowName),
  });
  await writeWorkflowSnapshot(outputsDir, monitorWorkflowSnapshot(options.workflowName));
}
