import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { abortVisibleWorkflowRun, startVisibleWorkflowRun } from "../src/display/visible-workflow-run.ts";
import { readWorkflowOutputManifest, readWorkflowSnapshot, workflowFinalOutputPath } from "../src/workflow/outputs.ts";
import { readWorkflowRunRecord } from "../src/workflow/run-record.ts";
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
  const [first, second] = await Promise.all([
    abortVisibleWorkflowRun(ctx, visible.run.runId),
    abortVisibleWorkflowRun(ctx, visible.run.runId),
  ]);
  assert.equal(first.status, "abort-requested");
  assert.equal(second.status, "already-aborting");
  assert.equal(first.outputsDir, visible.run.outputsDir);
  await assert.rejects(visible.run.finished, /agent aborted/);

  const record = await readWorkflowRunRecord(project, "session-a", visible.run.runId);
  assert.equal(record?.status, "aborted");
  assert.equal((await readWorkflowSnapshot(visible.run.outputsDir)).status, "aborted");
  assert.equal((await readWorkflowOutputManifest(visible.run.outputsDir)).error, undefined);
  await assert.rejects(readFile(workflowFinalOutputPath(visible.run.outputsDir), "utf8"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(handoffs.some((handoff) => handoff.includes('<workflow_handoff event="aborted">')));
});

function context(cwd: string, sessionId: string): ExtensionContext {
  return {
    cwd,
    mode: "json",
    isIdle: () => false,
    sessionManager: { getSessionId: () => sessionId },
    ui: { notify: () => undefined },
  } as unknown as ExtensionContext;
}
