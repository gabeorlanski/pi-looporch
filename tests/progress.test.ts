import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTokenCount, initialProgressDisplay, progressDisplay } from "../src/display/progress.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../src/runtime.ts";

void test("workflow_progress_table_collapses_completed_phase_children_and_expands_active_phase", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    phases: ["collect", "fanout"],
    logs: ["hidden from compact progress"],
    agents: [
      agent({
        id: 1,
        phaseIndex: 1,
        phase: "collect",
        label: "inventory",
        status: "done",
        model: "gpt-5",
        reasoning: "low",
        inputTokenCount: 1200,
        outputTokenCount: 900,
        toolCallCount: 2,
        startedAt: 1_000,
        endedAt: 3_450,
      }),
      agent({
        id: 2,
        phaseIndex: 2,
        phase: "fanout",
        label: "a.ts",
        status: "done",
        model: "gpt-5-mini",
        reasoning: "minimal",
        inputTokenCount: 500,
        outputTokenCount: 300,
        toolCallCount: 1,
      }),
      agent({
        id: 3,
        phaseIndex: 2,
        phase: "fanout",
        label: "b.ts",
        status: "running",
        model: "gpt-5",
        reasoning: "medium",
        inputTokenCount: 700,
        outputTokenCount: 100,
        toolCallCount: 3,
        message: "using read",
      }),
    ],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
    input: { files: ["a.ts", "b.ts"], focus: "auth" },
  };

  const display = progressDisplay(snapshot, 112);

  assert.equal(display.statusLine, "review: RUNNING · 2/3 agents · in 2.4k · out 1.3k · tools 6 · Esc abort · Ctrl+\\ transcript");
  assert.ok(display.widgetLines.some((line) => line.includes('args {"files":["a.ts","b.ts"],"focus":"auth"}')));
  assert.ok(display.widgetLines.some((line) => line.includes("RUNNING") && line.includes("Esc abort")));
  assert.ok(
    display.widgetLines.some(
      (line) => line.includes("✓ P1 collect") && line.includes("1/1 agents") && line.includes("1.2k→900") && line.includes("2.5s"),
    ),
  );
  assert.ok(display.widgetLines.some((line) => line.includes("▸ P2 fanout") && line.includes("1/2 agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("#1 inventory")));
  assert.ok(display.widgetLines.some((line) => line.includes("#3 b.ts") && line.includes("medium")));
  assert.ok(display.widgetLines.some((line) => line.includes("↳ using read")));
  assert.ok(display.widgetLines.some((line) => line.includes("NET 2/3 agents") && line.includes("2.4k in") && line.includes("6 tools")));
});

void test("workflow_progress_table_falls_back_to_startup_phase_before_explicit_phase", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "select",
    description: "Select workflow",
    phases: [],
    logs: [],
    agents: [agent({ id: 1, label: "selector", status: "running", tokenCount: 1 })],
    fanOuts: [],
  };

  const display = progressDisplay(snapshot, 88);

  assert.equal(display.statusLine, "select: RUNNING · 0/1 agents · in 0 · out 0 · tools 0 · Esc abort · Ctrl+\\ transcript");
  assert.ok(display.widgetLines.some((line) => line.includes("▸ setup") && line.includes("0/1 agents")));
  assert.ok(display.widgetLines.some((line) => line.includes("#1 selector")));
});

void test("workflow_progress_table_numbers_repeated_phase_titles_by_original_order", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "repeat",
    description: "Repeat phase names",
    phases: ["scan", "scan"],
    logs: [],
    agents: [
      agent({ id: 1, phaseIndex: 1, phase: "scan", label: "first", status: "done", endedAt: 100 }),
      agent({ id: 2, phaseIndex: 2, phase: "scan", label: "second", status: "running" }),
    ],
    fanOuts: [],
  };

  const display = progressDisplay(snapshot, 96);

  assert.ok(display.widgetLines.some((line) => line.includes("✓ P1 scan") && line.includes("1/1 agents")));
  assert.ok(display.widgetLines.some((line) => line.includes("▸ P2 scan") && line.includes("0/1 agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("setup scan")));
});

void test("initial_workflow_progress_uses_empty_net_summary", () => {
  const display = initialProgressDisplay("review", 72, undefined, { files: ["src/a.ts"], focus: "auth" });

  assert.equal(display.statusLine, "review: STARTING · 0/0 agents · in 0 · out 0 · tools 0 · Esc abort · Ctrl+\\ transcript");
  assert.ok(display.widgetLines.some((line) => line.includes('args {"files":["src/a.ts"],"focus":"auth"}')));
  assert.ok(display.widgetLines.some((line) => line.includes("waiting for workflow runtime events")));
  assert.ok(display.widgetLines.some((line) => line.includes("Esc abort")));
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
    tokenCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    toolCallCount: 0,
    ...overrides,
  };
}
