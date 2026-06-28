import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultWorkflowInspectorState,
  reduceWorkflowInspectorState,
  renderCollapsedWorkflowWidget,
  renderWorkflowInspector,
} from "../src/display/workflow-inspector.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../src/runtime.ts";

void test("workflow_inspector_collapsed_widget_shows_live_summary_and_hint", () => {
  const lines = renderCollapsedWorkflowWidget(snapshot(), 110);

  assert.equal(lines.length, 2);
  assert.match(lines[0], /← for agents/);
  assert.match(lines[1], /pyda-interventions/);
  assert.match(lines[1], /Net-metric-aware/);
  assert.match(lines[1], /2\/3 agents done/);
  assert.match(lines[1], /↓210\.7k tokens/);
});

void test("workflow_inspector_phases_screen_renders_phase_list_and_selected_phase_agent_preview", () => {
  const state = { ...defaultWorkflowInspectorState(), level: "phases" as const, selectedPhaseIdx: 1 };
  const lines = renderWorkflowInspector(snapshot(), state, 110, 16);

  assert.ok(lines.some((line) => line.includes("pyda-interventions")));
  assert.ok(lines.some((line) => line.includes("Phases")));
  assert.ok(lines.some((line) => line.includes("›◐ Analyze") && line.includes("1/2")));
  assert.ok(lines.some((line) => line.includes("3 Synthesize")));
  assert.ok(lines.some((line) => line.includes("starter:communication_log") && line.includes("Sonnet 4.6")));
  assert.ok(lines.some((line) => line.includes("↕ select · x stop workflow · p pause · esc back · s save")));
});

void test("workflow_inspector_detail_screen_promotes_agent_list_and_renders_scrollable_outcome", () => {
  const state = { ...defaultWorkflowInspectorState(), level: "detail" as const, selectedPhaseIdx: 0, selectedAgentIdx: 0 };
  const lines = renderWorkflowInspector(snapshot(), state, 112, 20);

  assert.ok(lines.some((line) => line.includes("Digest · 1 agents")));
  assert.ok(lines.some((line) => line.includes("digest:01_retail_signal_audit")));
  assert.ok(lines.some((line) => line.includes("✔ Completed · Sonnet 4.6")));
  assert.ok(lines.some((line) => line.includes("Prompt · 3 lines · ⏎ expand")));
  assert.ok(lines.some((line) => line.includes("… 2 more lines")));
  assert.ok(lines.some((line) => line.includes("Outcome")));
  assert.ok(lines.some((line) => line.includes('"slug": "01_retail_signal_audit"')));
  assert.ok(lines.some((line) => line.includes("↑↓ agent · j/k scroll · ⏎ prompt · p pause · esc back · s save")));
});

void test("workflow_inspector_keeps_startup_agents_visible_before_planned_phases", () => {
  const withStartup = snapshot();
  withStartup.agents.unshift(agent({ id: 4, phaseIndex: 0, label: "setup:repo_scan", status: "running" }));
  const lines = renderWorkflowInspector(withStartup, { ...defaultWorkflowInspectorState(), level: "phases", selectedPhaseIdx: 0 }, 112, 16);

  assert.ok(lines.some((line) => line.includes("›◐ startup") && line.includes("0/1")));
  assert.ok(lines.some((line) => line.includes("setup:repo_scan")));
});

void test("workflow_inspector_detail_scroll_uses_the_actual_panel_viewport", () => {
  const longSnapshot = snapshot();
  const firstAgent = longSnapshot.agents[0];
  assert.ok(firstAgent);
  longSnapshot.agents[0] = {
    ...firstAgent,
    outputPreview: Array.from({ length: 30 }, (_unused, index) => `line-${String(index).padStart(2, "0")}`).join("\n"),
  };
  const lines = renderWorkflowInspector(
    longSnapshot,
    { ...defaultWorkflowInspectorState(), level: "detail", selectedPhaseIdx: 0, selectedAgentIdx: 0, contentScrollOffset: 18 },
    112,
    12,
  );

  assert.ok(lines.some((line) => line.includes("line-09") || line.includes("line-10") || line.includes("line-11")));
  assert.ok(lines.some((line) => /\d+–\d+ of \d+/.test(line)));
});

void test("workflow_inspector_state_machine_keeps_navigation_axes_independent", () => {
  const start = { ...defaultWorkflowInspectorState(), level: "phases" as const, selectedPhaseIdx: 1 };
  const detail = reduceWorkflowInspectorState(start, snapshot(), "right");
  assert.deepEqual(
    { level: detail.level, phase: detail.selectedPhaseIdx, agent: detail.selectedAgentIdx, scroll: detail.contentScrollOffset },
    {
      level: "detail",
      phase: 1,
      agent: 0,
      scroll: 0,
    },
  );

  const scrolled = reduceWorkflowInspectorState(detail, snapshot(), "scrollDown");
  assert.equal(scrolled.selectedAgentIdx, 0);
  assert.equal(scrolled.contentScrollOffset, 1);

  const nextAgent = reduceWorkflowInspectorState({ ...scrolled, promptExpanded: true }, snapshot(), "down");
  assert.equal(nextAgent.selectedAgentIdx, 1);
  assert.equal(nextAgent.contentScrollOffset, 0);
  assert.equal(nextAgent.promptExpanded, false);

  const phases = reduceWorkflowInspectorState(nextAgent, snapshot(), "escape");
  assert.equal(phases.level, "phases");
  assert.equal(reduceWorkflowInspectorState(phases, snapshot(), "escape").level, "chat");
});

void test("workflow_inspector_prompt_expand_recomputes_detail_body", () => {
  const collapsed = renderWorkflowInspector(
    snapshot(),
    { ...defaultWorkflowInspectorState(), level: "detail", selectedPhaseIdx: 0, selectedAgentIdx: 0, promptExpanded: false },
    112,
    24,
  );
  const expanded = renderWorkflowInspector(
    snapshot(),
    { ...defaultWorkflowInspectorState(), level: "detail", selectedPhaseIdx: 0, selectedAgentIdx: 0, promptExpanded: true },
    112,
    24,
  );

  assert.ok(collapsed.some((line) => line.includes("… 2 more lines")));
  assert.ok(expanded.some((line) => line.includes("Use source files")));
  assert.ok(expanded.every((line) => !line.includes("… 2 more lines")));
});

function snapshot(): WorkflowSnapshot {
  const now = Date.now();
  return {
    workflowName: "pyda-interventions",
    description: "Net-metric-aware per-step intervention analysis for problems/pyda",
    plannedPhases: [{ title: "Digest" }, { title: "Analyze" }, { title: "Synthesize" }],
    phases: ["Digest", "Analyze"],
    logs: [],
    traces: [],
    agents: [
      agent({
        id: 1,
        phaseIndex: 1,
        phase: "Digest",
        label: "digest:01_retail_signal_audit",
        status: "done",
        model: "Sonnet 4.6",
        startedAt: now - 296_000,
        endedAt: now,
        tokenCount: 94_100,
        inputTokenCount: 80_000,
        outputTokenCount: 14_100,
        toolCallCount: 17,
        promptPreview: "Digest ONE phase-2 step\nUse source files\nReturn JSON",
        outputPreview: JSON.stringify({ slug: "01_retail_signal_audit", what_step_does: "Builds metrics", notes: ["a", "b"] }, null, 2),
        recentToolCalls: [
          { tool: "Read", args: "/Users/gabe/project/problems/pyda/problem.py" },
          { tool: "StructuredOutput", args: "01_retail_signal_audit" },
        ],
      }),
      agent({
        id: 2,
        phaseIndex: 2,
        phase: "Analyze",
        label: "starter:communication_log",
        status: "done",
        model: "Sonnet 4.6",
        tokenCount: 112_100,
        inputTokenCount: 100_000,
        outputTokenCount: 12_100,
        toolCallCount: 13,
      }),
      agent({
        id: 3,
        phaseIndex: 2,
        phase: "Analyze",
        label: "tests:communication_log",
        status: "running",
        model: "Sonnet 4.6",
        tokenCount: 4500,
        inputTokenCount: 4000,
        outputTokenCount: 500,
        toolCallCount: 3,
      }),
    ],
    fanOuts: [],
  };
}

function agent(overrides: Partial<WorkflowAgentSnapshot> & Pick<WorkflowAgentSnapshot, "id" | "label" | "status">): WorkflowAgentSnapshot {
  return {
    phaseIndex: 0,
    startedAt: 0,
    tokenCount: 0,
    inputTokenCount: 0,
    outputTokenCount: 0,
    toolCallCount: 0,
    stepCount: 0,
    ...overrides,
  };
}
