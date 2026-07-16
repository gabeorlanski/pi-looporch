import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatTokenCount, initialProgressDisplay, progressDisplay } from "../src/display/progress.ts";
import { WorkflowInspectorModel } from "../src/display/workflow-inspector-model.ts";
import { WorkflowInspector } from "../src/display/workflow-inspector.ts";
import { plainWorkflowTuiTheme } from "../src/display/workflow-tui-format.ts";
import { WorkflowWidget } from "../src/display/workflow-widget.ts";
import { clearRunningWorkflowUi, updateRunningWorkflowUi } from "../src/display/running-workflow-ui.ts";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../src/runtime/types.ts";

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

void test("progress summarizes status, input, tokens, and agents", () => {
  const snapshot: WorkflowSnapshot = {
    workflowName: "review",
    description: "Review files",
    plannedPhases: [],
    phases: ["collect", "fanout"],
    traces: [{ label: "selected inputs", phaseIndex: 2, phase: "fanout", value: { count: 2 } }],
    agents: [
      agent({
        id: 1,
        phaseIndex: 1,
        phase: "collect",
        label: "inventory",
        status: "done",
        inputTokenCount: 1200,
        cacheReadTokenCount: 500,
        outputTokenCount: 900,
        cost: { knownUsd: 0.1, complete: true },
      }),
      agent({
        id: 2,
        phaseIndex: 2,
        phase: "fanout",
        label: "b.ts",
        status: "running",
        model: "gpt-5",
        reasoning: "medium",
        inputTokenCount: 700,
        cacheReadTokenCount: 300,
        outputTokenCount: 100,
        cost: { knownUsd: 0.02, complete: true },
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

  assert.equal(display.statusLine, "review: RUNNING · 1/2 agents · in 1.9k · cached 800 · out 1k · cost $0.12 · tools 3");
  assert.ok(display.widgetLines.some((line) => line.includes('input {"files":["a.ts","b.ts"],"focus":"auth"}')));
  assert.ok(display.widgetLines.some((line) => line.includes("P1 collect") && line.includes("P2 fanout")));
  assert.ok(display.widgetLines.some((line) => line.includes("RUNNING #2 b.ts") && line.includes("medium") && line.includes("4 steps")));
  assert.ok(display.widgetLines.some((line) => line.includes("1 completed/hidden agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("runtime log")));
  assert.ok(!display.widgetLines.some((line) => line.includes("using read")));
});

void test("progress reports errors without completed agent rows", () => {
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

  assert.equal(display.statusLine, "many: ERROR · 2/2 agents · in 0 · cached 0 · out 0 · cost $0.00+ · tools 0");
  assert.ok(display.widgetLines.some((line) => line.includes("ERROR #2 failed")));
  assert.ok(display.widgetLines.some((line) => line.includes("1 completed/hidden agents")));
  assert.ok(!display.widgetLines.some((line) => line.includes("#1 done")));
});

void test("initial_workflow_progress_uses_empty_net_summary", () => {
  const display = initialProgressDisplay("review", 72, undefined, { files: ["src/a.ts"], focus: "auth" });

  assert.equal(display.statusLine, "review: STARTING · 0/0 agents · in 0 · cached 0 · out 0 · cost $0.00 · tools 0");
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

interface TestWorkflowComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
}

void test("workflow_widget_and_inspector_render_within_width", () => {
  const model = new WorkflowInspectorModel({
    workflowName: "review",
    description: "Review auth-sensitive files",
    plannedPhases: [{ title: "collect" }, { title: "fanout" }],
    phases: ["collect", "fanout"],
    traces: [],
    agents: [
      agent({ id: 1, phaseIndex: 1, phase: "collect", label: "inventory", status: "done", inputTokenCount: 1200 }),
      agent({
        id: 2,
        phaseIndex: 2,
        phase: "fanout",
        label: "review src/auth.ts",
        status: "running",
        outputTokenCount: 300,
      }),
    ],
    fanOuts: [],
    messages: [{ phaseIndex: 2, phase: "fanout", agentId: 2, agentLabel: "review src/auth.ts", level: "info", message: "review started" }],
    status: "running",
  });

  const widgetLines = new WorkflowWidget(
    () => model,
    plainWorkflowTuiTheme,
    () => false,
  ).render(80);
  const inspectorLines = new WorkflowInspector(model, plainWorkflowTuiTheme, () => 18).render(100);

  assert.ok(widgetLines.some((line) => line.includes("workflow review")));
  assert.ok(widgetLines.some((line) => line.includes("cached 0") && line.includes("out 300") && line.includes("$0.00+")));
  assert.ok(inspectorLines.some((line) => line.includes("cached 0")));
  assert.ok(inspectorLines.some((line) => line.includes("out 300") && line.includes("$0.00+")));
  assert.ok(inspectorLines.some((line) => line.includes("collect")));
  assert.ok(widgetLines.every((line) => visibleWidth(line) <= 80));
  assert.ok(inspectorLines.every((line) => visibleWidth(line) <= 100));
  const narrowWidgetLines = new WorkflowWidget(
    () => model,
    plainWorkflowTuiTheme,
    () => false,
  ).render(64);
  const narrowInspectorLines = new WorkflowInspector(model, plainWorkflowTuiTheme, () => 18).render(64);
  assert.ok(narrowWidgetLines.some((line) => line.includes("in 1.2k") && line.includes("cached 0")));
  assert.ok(narrowWidgetLines.some((line) => line.includes("out 300") && line.includes("$0.00+")));
  assert.ok(narrowInspectorLines.some((line) => line.includes("in 1.2k") && line.includes("cached 0")));
  assert.ok(narrowInspectorLines.some((line) => line.includes("out 300") && line.includes("$0.00+")));
});

void test("inspector shows activity, output, and expandable prompts", async () => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "pi-workflow-inspector-"));
  const promptPath = path.join(artifactsDir, "prompt.txt");
  const activityPath = path.join(artifactsDir, "activity.jsonl");
  const outputPath = path.join(artifactsDir, "output.json");
  await Promise.all([
    writeFile(promptPath, "EXACT PROMPT\nRead src/auth.ts\n", "utf8"),
    writeFile(
      activityPath,
      [
        { name: "find", arguments: { pattern: "*.ts" } },
        { name: "read", arguments: { path: "src/auth.ts" } },
        { name: "bash", arguments: { command: `npm test ${"界".repeat(30)}` } },
        { name: "write", arguments: { path: "out.txt" } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
      "utf8",
    ),
    writeFile(outputPath, JSON.stringify(`EXACT OUTPUT\nDone ${"界".repeat(40)}`), "utf8"),
  ]);
  const model = new WorkflowInspectorModel(
    {
      workflowName: "review",
      description: "Review auth-sensitive files",
      plannedPhases: [{ title: "collect" }],
      phases: ["collect"],
      traces: [],
      agents: [
        agent({
          id: 1,
          phaseIndex: 1,
          phase: "collect",
          label: "inventory",
          status: "done",
          promptPath,
          activityPath,
          outputPath,
          sessionFile: "/tmp/session.jsonl",
          eventsFile: "/tmp/events.jsonl",
        }),
      ],
      fanOuts: [],
      messages: [],
      status: "done",
    },
    () => 2_000,
  );
  const inspector = new WorkflowInspector(model, plainWorkflowTuiTheme, () => 34);

  inspector.handleInput("\r");
  const collapsed = inspector.render(120).join("\n");

  assert.match(collapsed, /session file: \/tmp\/session\.jsonl/);
  assert.match(collapsed, /events file: \/tmp\/events\.jsonl/);
  assert.doesNotMatch(collapsed, /find \{"pattern":"\*\.ts"\}/);
  assert.match(collapsed, /read \{"path":"src\/auth\.ts"\}/);
  assert.match(collapsed, /bash \{"command":"npm test/);
  assert.match(collapsed, /write \{"path":"out\.txt"\}/);
  assert.match(collapsed, /EXACT OUTPUT/);
  assert.doesNotMatch(collapsed, /EXACT PROMPT/);
  assert.ok(inspector.render(50).every((line) => visibleWidth(line) <= 50));

  inspector.handleInput("\r");
  const expanded = inspector.render(120).join("\n");

  assert.match(expanded, /EXACT PROMPT/);
});

void test("running workflow UI selects, inspects, and aborts", () => {
  let editorText = "";
  let terminalInputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
  let widget: TestWorkflowComponent | undefined;
  let overlay: TestWorkflowComponent | undefined;
  let workflowStatus: string | undefined;
  let aborted = false;
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: {
      getSessionId: () => "progress-test-session",
    },
    ui: {
      setStatus(key: string, text: string | undefined): void {
        if (key === "workflow") workflowStatus = text;
      },
      onTerminalInput(handler: (data: string) => { consume?: boolean } | undefined): () => void {
        terminalInputHandler = handler;
        return () => {
          terminalInputHandler = undefined;
        };
      },
      getEditorText(): string {
        return editorText;
      },
      custom<T>(
        factory: (
          tui: { requestRender(): void; terminal: { rows: number } },
          theme: typeof plainTheme,
          keybindings: unknown,
          done: (result: T) => void,
        ) => TestWorkflowComponent,
      ): Promise<T> {
        return new Promise<T>((resolve) => {
          overlay = factory({ terminal: { rows: 24 }, requestRender: noop }, plainTheme, {}, resolve);
        });
      },
      setWidget(key: string, content: unknown): void {
        if (key !== "pi-workflow-running") return;
        if (typeof content === "function") {
          const factory = content as (
            tui: { requestRender(): void; terminal: { rows: number } },
            theme: typeof plainTheme,
          ) => TestWorkflowComponent;
          widget = factory({ terminal: { rows: 24 }, requestRender: noop }, plainTheme);
        } else widget = undefined;
      },
    },
  } as unknown as ExtensionCommandContext;

  updateRunningWorkflowUi(ctx, { runId: "run-1", snapshot: workflowSnapshot(), abortWorkflow: () => (aborted = true) });
  assert.match(workflowStatus ?? "", /in 0 .* cached 0 .* out 0 .* \$0\.00/);
  updateRunningWorkflowUi(ctx, {
    runId: "run-1",
    snapshot: {
      ...workflowSnapshot(),
      agents: [
        agent({
          id: 1,
          phaseIndex: 1,
          phase: "collect",
          label: "inventory",
          status: "running",
          startedAt: Date.now(),
          inputTokenCount: 100,
          cacheReadTokenCount: 50,
          outputTokenCount: 30,
          cost: { knownUsd: 0.12, complete: true },
        }),
      ],
    },
  });
  assert.match(workflowStatus ?? "", /in 100 .* cached 50 .* out 30 .* \$0\.12/);
  updateRunningWorkflowUi(ctx, { runId: "run-2", snapshot: workflowSnapshot(), abortWorkflow: () => (aborted = true) });
  assert.match(workflowStatus ?? "", /^2 workflows/);
  assert.match(workflowStatus ?? "", /\$0\.12\+/);
  clearRunningWorkflowUi(ctx, "run-1");
  assert.match(workflowStatus ?? "", /^Workflow/);
  assert.ok(terminalInputHandler);
  assert.ok(widget);
  const handler = terminalInputHandler;
  const widgetComponent = widget;

  assert.deepEqual(handler("\u001B[B"), { consume: true });
  assert.ok(widgetComponent.render(80).some((line) => line.includes("open inspector")));
  assert.deepEqual(handler("\u001B[A"), { consume: true });
  editorText = "not empty";
  assert.equal(handler("\u001B[B"), undefined);
  editorText = "";
  assert.deepEqual(handler("\u001B[B"), { consume: true });
  assert.deepEqual(handler("\r"), { consume: true });
  assert.ok(overlay);
  const overlayComponent = overlay;
  assert.ok(overlayComponent.render(100).some((line) => line.includes("workflow review")));

  overlayComponent.handleInput?.("x");

  assert.equal(aborted, true);
  clearRunningWorkflowUi(ctx, "run-2");
  assert.equal(workflowStatus, undefined);
});

function noop(): void {
  return undefined;
}

function workflowSnapshot(): WorkflowSnapshot {
  return {
    workflowName: "review",
    description: "Review auth-sensitive files",
    plannedPhases: [{ title: "collect" }],
    phases: ["collect"],
    traces: [],
    agents: [agent({ id: 1, phaseIndex: 1, phase: "collect", label: "inventory", status: "running", startedAt: Date.now() })],
    fanOuts: [],
    messages: [],
    status: "running",
  };
}

function agent(overrides: Partial<WorkflowAgentSnapshot> & Pick<WorkflowAgentSnapshot, "id" | "label" | "status">): WorkflowAgentSnapshot {
  return {
    phaseIndex: 0,
    startedAt: 0,
    inputTokenCount: 0,
    cacheReadTokenCount: 0,
    outputTokenCount: 0,
    cost: { knownUsd: 0, complete: false },
    toolCallCount: 0,
    stepCount: 0,
    ...overrides,
  };
}
