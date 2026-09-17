import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abortVisibleWorkflowRun, startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import { createWorkflowTools } from "../src/tools.ts";
import { readWorkflowOutputManifest, readWorkflowSnapshot, workflowFinalOutputPath } from "../src/workflow/outputs.ts";
import { readWorkflowRunRecord, writeRunRecord } from "../src/workflow/run-record.ts";
import { workflowRunDirectory } from "../src/workflow/run-storage.ts";
import { prepareWorkflowResume, startPreparedWorkflowRun } from "../src/workflow/start.ts";
import type { WorkflowAgent } from "../src/runtime/types.ts";

void test("an owned workflow can be aborted once with durable aborted artifacts and a final handoff", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-abort-"));
  const workflowDirectory = path.join(project, ".pi", "workflows", "wait");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "workflow.js"),
    `export const metadata = { name: "wait", description: "Wait for cancellation", inputInstructions: "No input.", phases: [{ title: "Wait" }] };
export default async function workflow() {
  phase("Wait");
  return agent("wait", { label: "waiter" });
}`,
    "utf8",
  );

  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const agent: WorkflowAgent = (_prompt, options, reporter) => {
    reporter.launched("wait");
    markStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("agent aborted"));
        },
        { once: true },
      );
    });
  };
  const handoffs: string[] = [];
  const ctx = context(project, "session-a");
  const visible = await startVisibleWorkflowRun({
    ctx,
    cwd: project,
    workflowName: "wait",
    input: {},
    agentDir: project,
    agent,
    llm: () => Promise.reject(new Error("The waiting workflow must not call the LLM.")),
    sendUserMessage: (message) => {
      handoffs.push(message);
    },
  });

  await started;
  const abortTool = createWorkflowTools({
    run: {
      runtimeForContext: () => ({ agent, llm: () => Promise.reject(new Error("The waiting workflow must not call the LLM.")) }),
      sendUserMessageForContext: () => () => undefined,
    },
    agentCapabilityCatalogForContext: () => {
      throw new Error("The abort tool must not load an agent capability catalog.");
    },
  }).find((tool) => tool.name === "abort_workflow");
  if (!abortTool) throw new Error("abort_workflow tool was not registered");
  const toolResponse = abortTool.execute("abort-call", { runId: visible.run.runId }, undefined, undefined, ctx);
  const second = await abortVisibleWorkflowRun(ctx, visible.run.runId);
  await toolResponse;
  assert.equal(second.status, "already-aborting");
  await assert.rejects(visible.run.finished, /agent aborted/);

  const record = await readWorkflowRunRecord(project, "session-a", visible.run.runId);
  assert.equal(record?.status, "aborted");
  assert.equal((await readWorkflowSnapshot(visible.run.outputsDir)).status, "aborted");
  assert.equal((await readWorkflowOutputManifest(visible.run.outputsDir)).error, undefined);
  await assert.rejects(readFile(workflowFinalOutputPath(visible.run.outputsDir), "utf8"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(handoffs.some((handoff) => handoff.includes('<workflow_handoff event="aborted">')));

  const resumed = await startPreparedWorkflowRun({
    prepared: await prepareWorkflowResume({
      cwd: project,
      runId: visible.run.runId,
      ownerSessionId: "session-a",
      agentDir: project,
    }),
    agent: (prompt, _options, reporter) => {
      reporter.launched(prompt);
      return Promise.resolve({ resumed: true });
    },
    llm: () => Promise.reject(new Error("The waiting workflow must not call the LLM.")),
    ownerSessionId: "session-a",
  });
  assert.deepEqual((await resumed.finished).result, { resumed: true });
});

void test("aborting rejects unknown and foreign runs while terminal owned runs are idempotent", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-abort-"));
  const ctx = context(project, "session-a");
  await writeRunRecord(
    workflowRunDirectory(project, "session-a", "aborted-run"),
    runRecord(project, "session-a", "aborted-run", "aborted"),
  );
  await writeRunRecord(workflowRunDirectory(project, "session-a", "done-run"), runRecord(project, "session-a", "done-run", "done"));
  await writeRunRecord(
    workflowRunDirectory(project, "session-b", "foreign-run"),
    runRecord(project, "session-b", "foreign-run", "running"),
  );

  assert.equal((await abortVisibleWorkflowRun(ctx, "aborted-run")).status, "already-aborted");
  assert.equal((await abortVisibleWorkflowRun(ctx, "done-run")).status, "already-finished");
  await assert.rejects(abortVisibleWorkflowRun(ctx, "unknown-run"), /not found in the current live session/);
  await assert.rejects(abortVisibleWorkflowRun(ctx, "foreign-run"), /not found in the current live session/);
});

function runRecord(project: string, ownerSessionId: string, runId: string, status: "running" | "done" | "aborted") {
  return {
    runId,
    workflowName: "review",
    cwd: project,
    input: {},
    ownerSessionId,
    ownerProcessId: process.pid,
    startedAt: 1,
    resumeCount: 0,
    status,
  };
}

function context(cwd: string, sessionId: string): ExtensionContext {
  return {
    cwd,
    mode: "json",
    isIdle: () => false,
    sessionManager: { getSessionId: () => sessionId },
    ui: { notify: () => undefined },
  } as unknown as ExtensionContext;
}
