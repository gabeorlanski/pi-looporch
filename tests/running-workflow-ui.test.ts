import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { clearRunningWorkflowUi, openRunningWorkflowInspector, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import type { WorkflowSnapshot } from "../src/runtime/types.ts";

void test("replacing a session context preserves its other running workflows", async () => {
  const first = context("session-a");
  const replacement = context("session-a");
  updateRunningWorkflowUi(first, { runId: "run-a", snapshot: snapshot("alpha") });
  updateRunningWorkflowUi(first, { runId: "run-b", snapshot: snapshot("beta") });

  updateRunningWorkflowUi(replacement, { runId: "run-b", snapshot: snapshot("beta") });
  clearRunningWorkflowUi(replacement, "run-b");

  assert.equal(await openRunningWorkflowInspector(replacement), true);
  clearRunningWorkflowUi(replacement, "run-a");
});

function context(sessionId: string): ExtensionContext {
  return {
    cwd: "/tmp/pi-looporch-ui-test",
    mode: "tui",
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      setWidget: () => undefined,
      setStatus: () => undefined,
      onTerminalInput: () => () => undefined,
      custom: () => Promise.resolve(undefined),
    },
  } as unknown as ExtensionContext;
}

function snapshot(workflowName: string): WorkflowSnapshot {
  return {
    workflowName,
    description: workflowName,
    plannedPhases: [],
    phases: [],
    traces: [],
    agents: [],
    llms: [],
    fanOuts: [],
    messages: [],
    status: "running",
  };
}
