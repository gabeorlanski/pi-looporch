import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTokenCount, initialProgressDisplay, progressDisplay } from "../src/display/progress.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../src/runtime/types.ts";

void test("workflow_progress_summarizes_status_input_tokens_and_active_agents", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: ["collect", "fanout"],
    traces: [{ label: "selected inputs", phaseIndex: 2, phase: "fanout", value: { count: 2 } }],
    agents: [
      agent({ id: 1, phaseIndex: 1, phase: "collect", label: "inventory", status: "done", inputTokenCount: 1200, outputTokenCount: 900 }),
      agent({
        id: 2,
        phaseIndex: 2,
        phase: "fanout",
        label: "b.ts",
        status: "running",
        model: "gpt-5",
        reasoning: "medium",
        inputTokenCount: 700,
        outputTokenCount: 100,
        toolCallCount: 3,
        stepCount: 4,
        message: "using read",
      }),
    ],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
    messages: [{ phaseIndex: 2, phase: "fanout", level: "info", message: "log visible in runtime log" }],
    status: "running",
    input: { files: ["a.ts", "b.ts"], focus: "auth" },
  };

  const display = progressDisplay(snapshot, 112);

  assert.equal(display.statusLine, "review: RUNNING · 1/2 agents · in 1.9k · out 1k · tools 3");
  assert.ok(display.widgetLines.some((line) => line.includes('input {"files":["a.ts","b.ts"],"focus":"auth"}')));
  assert.ok(display.widgetLines.some((line) => line.includes("P1 collect") && line.includes("P2 fanout")));
  assert.ok(display.widgetLines.some((line) => line.includes("RUNNING #2 b.ts") && line.includes("medium") && line.includes("4 steps")));
  assert.ok(display.widgetLines.some((line) => line.includes("1 completed/hidden agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("runtime log")));
  assert.ok(!display.widgetLines.some((line) => line.includes("using read")));
});

void test("workflow_progress_reports_errors_without_rendering_completed_agent_rows", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "many",
    description: "Many agents",
    plannedPhases: [],
    phases: ["fanout"],
    traces: [],
    agents: [
      agent({ id: 1, phaseIndex: 1, phase: "fanout", label: "done", status: "done" }),
      agent({ id: 2, phaseIndex: 1, phase: "fanout", label: "failed", status: "error", error: "failed" }),
    ],
    fanOuts: [],
    messages: [],
    status: "error",
  };

  const display = progressDisplay(snapshot, 96);

  assert.equal(display.statusLine, "many: ERROR · 2/2 agents · in 0 · out 0 · tools 0");
  assert.ok(display.widgetLines.some((line) => line.includes("ERROR #2 failed")));
  assert.ok(display.widgetLines.some((line) => line.includes("1 completed/hidden agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("#1 done")));
});

void test("initial_workflow_progress_uses_empty_net_summary", () => {
  const display = initialProgressDisplay("review", 72, undefined, { files: ["src/a.ts"], focus: "auth" });

  assert.equal(display.statusLine, "review: STARTING · 0/0 agents · in 0 · out 0 · tools 0");
  assert.ok(display.widgetLines.some((line) => line.includes('input {"files":["src/a.ts"],"focus":"auth"}')));
  assert.ok(display.widgetLines.some((line) => line.includes("waiting for workflow runtime update")));
  assert.ok(display.widgetLines.some((line) => line.includes("NET 0/0 agents")));
});

void test("format_token_count_uses_readable_suffixes", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1000), "1k");
  assert.equal(formatTokenCount(1450), "1.4k");
  assert.equal(formatTokenCount(1_000_000), "1M");
});

function agent(overrides: Partial<WorkflowAgentSnapshot> & Pick<WorkflowAgentSnapshot, "id" | "label" | "status">): WorkflowAgentSnapshot {
  return {
    phaseIndex: 0,
    startedAt: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    toolCallCount: 0,
    stepCount: 0,
    ...overrides,
  };
}
