import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import piWorkflow from "../extensions/workflow.ts";

interface RegisteredTestCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface SentMessage {
  customType: string;
  content: string;
  display: boolean;
  details: unknown;
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

interface TestWidgetComponent {
  render(width: number): string[];
}

type TestWidgetFactory = (tui: { requestRender(): void; terminal: { rows: number } }, theme: typeof plainTheme) => TestWidgetComponent;

function isTestWidgetFactory(content: unknown): content is TestWidgetFactory {
  return typeof content === "function";
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition was not met before timeout");
}

void test("existing_workflow_command_runs_directly_with_progress_updates", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input", inputInstructions: "Use the workflow function JSDoc and signature to resolve input.", phases: [{ title: "Run" }] };
export default async function workflow(input) {
  phase("running");
  return input;
}`,
    "utf8",
  );

  const commands = new Map<string, RegisteredTestCommand>();
  const sentMessages: SentMessage[] = [];
  const sentUserMessages: unknown[] = [];
  const statusUpdates: (string | undefined)[] = [];
  const widgetUpdates: (string[] | undefined)[] = [];
  let activeWidget: TestWidgetComponent | undefined;
  let widgetInstallCount = 0;
  let widgetPlacement: string | undefined;
  let terminalInputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
  const editorText = "";
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(message: SentMessage): void {
      sentMessages.push(message);
    },
    sendUserMessage(message: unknown): void {
      sentUserMessages.push(message);
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    abort(): void {
      void project;
    },
    isIdle: () => true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        void message;
        void type;
      },
      setStatus(key: string, text: string | undefined): void {
        if (key === "workflow") statusUpdates.push(text);
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
      async custom<T>(
        factory: (
          tui: { requestRender(): void; terminal: { rows: number } },
          theme: typeof plainTheme,
          keybindings: unknown,
          done: (result: T) => void,
        ) => TestWidgetComponent,
      ): Promise<T> {
        return await new Promise<T>((resolve) => {
          const overlay = factory(
            {
              terminal: { rows: 32 },
              requestRender(): void {
                return undefined;
              },
            },
            plainTheme,
            {},
            resolve,
          );
          activeWidget = overlay;
        });
      },
      setWidget(key: string, content: unknown, options?: { placement?: string }): void {
        if (key !== "pi-workflow-running") return;
        widgetPlacement = options?.placement;
        if (isTestWidgetFactory(content)) {
          widgetInstallCount++;
          activeWidget = content(
            {
              terminal: { rows: 32 },
              requestRender(): void {
                if (activeWidget) widgetUpdates.push(activeWidget.render(72));
              },
            },
            plainTheme,
          );
          widgetUpdates.push(activeWidget.render(72));
          return;
        }
        activeWidget = undefined;
        widgetUpdates.push(content as string[] | undefined);
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler('echo message=hello count=10 debug=true files=src/index.ts,tests/index.test.ts note="hello world"', ctx);

  assert.equal(sentUserMessages.length, 0);
  assert.ok(statusUpdates.includes("Waiting for 1 dynamic workflow to finish"));
  assert.equal(widgetInstallCount, 1);
  assert.equal(widgetPlacement, "belowEditor");
  await waitForCondition(() =>
    widgetUpdates.some(
      (update) => update?.some((line) => line.includes("workflow echo")) && update.some((line) => line.includes("0/0 agents done")),
    ),
  );
  void terminalInputHandler;
  void editorText;
  await waitForCondition(() => sentMessages.length === 1 && statusUpdates.at(-1) === undefined);
  assert.match(sentMessages[0].content, /Workflow 'echo' complete\.\n\nWorkflow result: .*final\.json\n\nWorkflow session logs: /);
  assert.doesNotMatch(sentMessages[0].content, /hello world/);
});

void test("existing_workflow_command_does_not_report_success_notification_failure_as_workflow_failure", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "complete");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "complete", description: "Complete workflow", inputInstructions: "Use structured input.", phases: [{ title: "Run" }] };
export default async function workflow() {
  return { ok: true };
}`,
    "utf8",
  );

  const commands = new Map<string, RegisteredTestCommand>();
  const notifications: { message: string; type?: "info" | "warning" | "error" }[] = [];
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(): void {
      throw new Error("send failed");
    },
    sendUserMessage(message: unknown): void {
      void message;
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    abort(): void {
      void project;
    },
    isIdle: () => true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        notifications.push({ message, type });
      },
      setStatus(key: string, text: string | undefined): void {
        void key;
        void text;
      },
      onTerminalInput(): () => void {
        return () => undefined;
      },
      getEditorText(): string {
        return "";
      },
      custom<T>(): Promise<T> {
        return Promise.resolve(undefined as T);
      },
      setWidget(key: string, content: unknown): void {
        void key;
        void content;
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler("complete", ctx);
  await waitForCondition(() =>
    notifications.some((notification) => notification.message.includes("completed, but completion handling failed")),
  );

  assert.ok(notifications.some((notification) => notification.message.includes("send failed") && notification.type === "error"));
  assert.ok(notifications.every((notification) => !notification.message.includes("Workflow 'complete' failed")));
});

void test("workflow_settings_command_writes_project_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const commands = new Map<string, RegisteredTestCommand>();
  const notifications: { message: string; type?: string }[] = [];
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(message: unknown): void {
      void message;
    },
    sendUserMessage(message: unknown): void {
      void message;
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow-settings");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler("maxParallelAgents=8", ctx);

  assert.match(notifications.at(-1)?.message ?? "", /set to 8/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")), {
    workflow: { maxParallelAgents: 8 },
  });

  await command.handler("childAgentExtensions=pi-subagents,./extensions/todo.ts", ctx);

  assert.match(notifications.at(-1)?.message ?? "", /child agent extensions set/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, ".pi", "settings.json"), "utf8")), {
    workflow: { maxParallelAgents: 8, childAgentExtensions: ["pi-subagents", "./extensions/todo.ts"] },
  });
});

void test("workflow_settings_command_shows_readable_current_settings", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const commands = new Map<string, RegisteredTestCommand>();
  const sentMessages: SentMessage[] = [];
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(message: SentMessage): void {
      sentMessages.push(message);
    },
    sendUserMessage(message: unknown): void {
      void message;
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow-settings");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    ui: {
      notify(message: string): void {
        void message;
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler("", ctx);

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].display, true);
  assert.deepEqual((sentMessages[0].details as { kind?: string }).kind, "workflow-settings");
  assert.match(sentMessages[0].content, /# Workflow Settings/);
  assert.match(sentMessages[0].content, /Max parallel agents: 4/);
  assert.match(sentMessages[0].content, /Project: \.pi\/settings\.json/);
  assert.match(sentMessages[0].content, /\/workflow-settings maxParallelAgents=8/);
});

void test("existing_workflow_freeform_input_is_steered_in_current_session", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
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
    "utf8",
  );

  const commands = new Map<string, RegisteredTestCommand>();
  const sentMessages: { message: SentMessage; options: unknown }[] = [];
  const sentUserMessages: { message: unknown; options: unknown }[] = [];
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(message: SentMessage, options?: unknown): void {
      sentMessages.push({ message, options });
    },
    sendUserMessage(message: unknown, options?: unknown): void {
      sentUserMessages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    abort(): void {
      void project;
    },
    isIdle: () => false,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        void message;
        void type;
      },
      setStatus(key: string, text: string | undefined): void {
        void key;
        void text;
      },
      setWidget(key: string, content: unknown): void {
        void key;
        void content;
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler("echo hello from natural language", ctx);

  assert.deepEqual(sentUserMessages, []);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(sentMessages[0].message.display, true);
  assert.deepEqual(sentMessages[0].message.details, { kind: "workflow-agent-prompt" });
  assert.match(sentMessages[0].message.content, /Resolve input for workflow 'echo'/);
  assert.match(sentMessages[0].message.content, /call run_workflow/);
  assert.match(sentMessages[0].message.content, /Treat bare text as the message field/);
  assert.match(sentMessages[0].message.content, /input\.message/);
  assert.doesNotMatch(sentMessages[0].message.content, /workflow\.js, for secondary context only/);
  assert.doesNotMatch(sentMessages[0].message.content, /return \{ message \};/);
});

void test("existing_workflow_command_reports_missing_required_input_without_running", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "plan");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
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
    "utf8",
  );

  const commands = new Map<string, RegisteredTestCommand>();
  const sentMessages: SentMessage[] = [];
  const notifications: { message: string; type?: string }[] = [];
  const pi = {
    registerTool(tool: unknown): void {
      void tool;
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      void event;
      void handler;
    },
    sendMessage(message: SentMessage): void {
      sentMessages.push(message);
    },
    sendUserMessage(message: unknown): void {
      void message;
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);

  const command = commands.get("workflow");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    abort(): void {
      void project;
    },
    isIdle: () => true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        notifications.push({ message, type });
      },
      setStatus(key: string, text: string | undefined): void {
        void key;
        void text;
      },
      setWidget(key: string, content: unknown): void {
        void key;
        void content;
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler("plan repo=owner/name", ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].content, /missing required input: problem/);
  assert.match(sentMessages[0].content, /problem=<value>/);
  assert.equal(notifications.at(-1)?.type, "warning");
});
