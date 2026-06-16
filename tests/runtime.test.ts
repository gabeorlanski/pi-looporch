import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runWorkflowFromDirectory, type WorkflowAgent } from "../src/runtime.ts";

async function writeWorkflow(project: string, name: string, source: string, files: Record<string, string> = {}): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(workflowDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

void test("workflow_runs_with_core_primitives", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "review",
    `export const metadata = { name: "review", description: "Review files" };
export default async function workflow() {
  phase("fanout");
  const reviewed = await parallel(args.files, (file) => agent(readText("prompt.txt") + file, { label: file }), { label: "file reviews" });
  return pipeline(reviewed, [async (item) => ({ item, cwd })]);
}`,
    { "prompt.txt": "review " },
  );
  const agent: WorkflowAgent = (prompt, options, reportProgress) => {
    reportProgress({ tokenCount: 7 });
    return Promise.resolve(`${options.label ?? "unlabeled"}:${prompt}`);
  };

  const events: string[] = [];
  const result = await runWorkflowFromDirectory({
    cwd: project,
    workflowName: "review",
    input: { files: ["a.ts", "b.ts"] },
    agent,
    onEvent: (event) => events.push(event.type),
  });

  assert.deepEqual(result.result, [
    { item: "a.ts:review a.ts", cwd: project },
    { item: "b.ts:review b.ts", cwd: project },
  ]);
  assert.deepEqual(result.snapshot.phases, ["fanout"]);
  assert.equal(result.snapshot.agents.length, 2);
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.tokenCount),
    [7, 7],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.outputTokenCount),
    [7, 7],
  );
  assert.deepEqual(
    result.snapshot.agents.map((agentSnapshot) => agentSnapshot.fanOutId),
    [1, 1],
  );
  assert.deepEqual(result.snapshot.fanOuts, [{ id: 1, label: "file reviews", total: 2, running: 0, done: 2, error: 0 }]);
  assert.deepEqual(events, [
    "run_started",
    "phase",
    "fanout_started",
    "agent_started",
    "agent_progress",
    "agent_started",
    "agent_progress",
    "agent_done",
    "agent_done",
    "fanout_progress",
    "fanout_progress",
    "run_completed",
  ]);
});

void test("workflow_emits_heartbeat_snapshots_while_agent_is_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  await writeWorkflow(
    project,
    "heartbeat",
    `export const metadata = { name: "heartbeat", description: "Heartbeat" };
export default async function workflow() {
  return agent("wait", { label: "slow" });
}`,
  );
  const agent: WorkflowAgent = () => new Promise((resolve) => setTimeout(() => resolve("done"), 1100));
  let snapshots = 0;

  await runWorkflowFromDirectory({
    cwd: project,
    workflowName: "heartbeat",
    input: {},
    agent,
    onSnapshot: () => {
      snapshots++;
    },
  });

  assert.ok(snapshots >= 4);
});

void test("workflow_sandbox_blocks_ambient_authority_and_file_escapes", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-"));
  const agent: WorkflowAgent = () => Promise.resolve("unused");
  await writeWorkflow(
    project,
    "process",
    `export const metadata = { name: "process", description: "Process access" };
export default async function workflow() {
  return process.cwd();
}`,
  );
  await assert.rejects(runWorkflowFromDirectory({ cwd: project, workflowName: "process", input: {}, agent }), /process is not defined/);

  await writeWorkflow(
    project,
    "escape",
    `export const metadata = { name: "escape", description: "Escape access" };
export default async function workflow() {
  return readText("../secret.txt");
}`,
  );
  await assert.rejects(runWorkflowFromDirectory({ cwd: project, workflowName: "escape", input: {}, agent }), /escapes workflow directory/);
});
