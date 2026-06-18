import assert from "node:assert/strict";
import { test } from "node:test";
import { agentInspectorHeaderLines } from "../src/display/agent-inspector.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../src/runtime.ts";

void test("agent_inspector_header_identifies_the_selected_agent", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "",
    phases: ["collect", "fanout"],
    logs: [],
    agents: [
      agent({ id: 1, phaseIndex: 1, phase: "collect", label: "inventory", status: "done" }),
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
        fanOutId: 1,
      }),
    ],
    fanOuts: [{ id: 1, label: "file reviews", total: 2, running: 1, done: 1, error: 0 }],
  };

  const lines = agentInspectorHeaderLines(snapshot, 1, 90);

  assert.ok(lines.some((line) => line.includes("agent 2/2 · #2 b.ts")));
  assert.ok(lines.some((line) => line.includes("fanout") && line.includes("running") && line.includes("gpt-5/medium")));
  assert.ok(lines.some((line) => line.includes("700 in") && line.includes("3 tools")));
  assert.ok(lines.some((line) => line.includes("file reviews 1/2")));
  assert.ok(lines.some((line) => line.includes("switch agent") && line.includes("Esc close")));
});

void test("agent_inspector_header_clamps_selection_and_handles_empty", () => {
  const empty: WorkflowSnapshot = { workflowName: "x", description: "", phases: [], logs: [], agents: [], fanOuts: [] };
  assert.ok(agentInspectorHeaderLines(empty, 0, 80).some((line) => line.includes("No agents")));

  const snapshot: WorkflowSnapshot = {
    workflowName: "x",
    description: "",
    phases: [],
    logs: [],
    agents: [agent({ id: 1, label: "only", status: "running" })],
    fanOuts: [],
  };
  assert.ok(agentInspectorHeaderLines(snapshot, 9, 80).some((line) => line.includes("agent 1/1 · #1 only")));
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
