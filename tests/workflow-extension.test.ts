import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

void test("existing_workflow_command_runs_directly_with_progress_updates", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input" };
export default async function workflow() {
  phase("running");
  return args;
}`,
    "utf8",
  );

  const commands = new Map<string, RegisteredTestCommand>();
  const sentMessages: SentMessage[] = [];
  const sentUserMessages: unknown[] = [];
  const statusUpdates: (string | undefined)[] = [];
  const widgetUpdates: (string[] | undefined)[] = [];
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
    isIdle: () => true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        void message;
        void type;
      },
      setStatus(key: string, text: string | undefined): void {
        if (key === "workflow") statusUpdates.push(text);
      },
      setWidget(key: string, content: string[] | undefined): void {
        if (key === "pi-workflow-running") widgetUpdates.push(content);
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler('echo message=hello count=10 debug=true files=src/index.ts,tests/index.test.ts note="hello world"', ctx);

  assert.deepEqual(sentUserMessages, []);
  assert.ok(statusUpdates.includes("Phase: running  Progress: 0/0  Tokens: 0 tokens"));
  assert.deepEqual(statusUpdates.at(-1), undefined);
  assert.ok(
    widgetUpdates.some(
      (update) =>
        update?.[0] === "─── ◆ workflow: echo ────────────────────────────────────────────────────" &&
        update[1] === "  Phase: running  Progress: 0/0  Tokens: 0 tokens" &&
        update[5] === "  running           0/0       0 tokens",
    ),
  );
  assert.deepEqual(
    sentMessages.map((message) => message.content),
    [
      'Workflow \'echo\' complete.\n\n{\n  "message": "hello",\n  "count": 10,\n  "debug": true,\n  "files": [\n    "src/index.ts",\n    "tests/index.test.ts"\n  ],\n  "note": "hello world"\n}',
    ],
  );
});

void test("existing_workflow_command_saves_debug_log_when_flag_is_set", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "pi-workflow-extension-"));
  const workflowDir = path.join(project, ".pi", "workflows", "echo");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.js"),
    `export const metadata = { name: "echo", description: "Echo input" };
export default async function workflow() {
  phase("running");
  log("about to return");
  return args;
}`,
    "utf8",
  );

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

  const command = commands.get("workflow");
  assert.ok(command);
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    isIdle: () => true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        void message;
        void type;
      },
      setStatus(key: string, text: string | undefined): void {
        void key;
        void text;
      },
      setWidget(key: string, content: string[] | undefined): void {
        void key;
        void content;
      },
    },
  } as unknown as ExtensionCommandContext;

  await command.handler('echo --save-log message=hello note="hello world"', ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].content, /Saved workflow log: \.pi\/workflow-runs\//);
  assert.match(sentMessages[0].content, /"message": "hello"/);
  assert.doesNotMatch(sentMessages[0].content, /save-log/);
  const runIds = await readdir(path.join(project, ".pi", "workflow-runs"));
  assert.equal(runIds.length, 1);
  const runDir = path.join(project, ".pi", "workflow-runs", runIds[0]);
  const input = JSON.parse(await readFile(path.join(runDir, "input.json"), "utf8")) as unknown;
  assert.deepEqual(input, { message: "hello", note: "hello world" });
  const events = (await readFile(path.join(runDir, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event: { type: string } });
  assert.deepEqual(
    events.map((event) => event.event.type),
    ["run_started", "phase", "log", "run_completed"],
  );
  const finalSnapshot = JSON.parse(await readFile(path.join(runDir, "final-snapshot.json"), "utf8")) as { logs: string[] };
  assert.deepEqual(finalSnapshot.logs, ["about to return"]);
});
