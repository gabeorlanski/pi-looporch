import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import piWorkflow from "../extensions/workflow.ts";

interface RegisteredTestCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface TestSessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload";
}

type TestSessionStartHandler = (event: TestSessionStartEvent, ctx: ExtensionCommandContext) => Promise<void> | void;

export interface SentMessage {
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

export interface ExtensionHarnessOptions {
  cwd: string;
  idle?: boolean;
  editorText?: string;
  sendMessage?: (message: SentMessage, options?: unknown) => void;
}

export interface ExtensionHarness {
  commands: Map<string, RegisteredTestCommand>;
  tools: Map<string, ToolDefinition>;
  ctx: ExtensionCommandContext;
  sentMessages: { message: SentMessage; options: unknown }[];
  sentUserMessages: { message: unknown; options: unknown }[];
  notifications: { message: string; type?: "info" | "warning" | "error" }[];
  statusUpdates: (string | undefined)[];
  widgetUpdates: (string[] | undefined)[];
  customUpdates: string[][];
  widgetInstallCount: () => number;
  widgetPlacement: () => string | undefined;
  customOpenCount: () => number;
  closeCustom: () => void;
  sessionStart: (reason?: "startup" | "reload") => Promise<void>;
  command: (name: string, args: string) => Promise<void>;
}

export function createExtensionHarness(options: ExtensionHarnessOptions): ExtensionHarness {
  const commands = new Map<string, RegisteredTestCommand>();
  const tools = new Map<string, ToolDefinition>();
  const sentMessages: { message: SentMessage; options: unknown }[] = [];
  const sentUserMessages: { message: unknown; options: unknown }[] = [];
  const notifications: { message: string; type?: "info" | "warning" | "error" }[] = [];
  const statusUpdates: (string | undefined)[] = [];
  const widgetUpdates: (string[] | undefined)[] = [];
  const customUpdates: string[][] = [];
  let activeWidget: TestWidgetComponent | undefined;
  let activeCustom: TestWidgetComponent | undefined;
  let closeActiveCustom: (() => void) | undefined;
  let widgetInstallCount = 0;
  let customOpenCount = 0;
  let widgetPlacement: string | undefined;
  let terminalInputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
  const sessionStartHandlers: TestSessionStartHandler[] = [];
  const pi = {
    registerTool(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      if (event === "session_start") sessionStartHandlers.push(handler as TestSessionStartHandler);
    },
    sendMessage(message: SentMessage, sendOptions?: unknown): void {
      if (options.sendMessage) {
        options.sendMessage(message, sendOptions);
        return;
      }
      sentMessages.push({ message, options: sendOptions });
    },
    sendUserMessage(message: unknown, sendOptions?: unknown): void {
      sentUserMessages.push({ message, options: sendOptions });
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);
  const ctx = {
    cwd: options.cwd,
    mode: "tui",
    hasUI: true,
    signal: undefined,
    abort(): void {
      void options.cwd;
    },
    isIdle: () => options.idle ?? true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error"): void {
        notifications.push({ message, type });
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
        return options.editorText ?? "";
      },
      async custom<T>(
        factory: (
          tui: { requestRender(): void; terminal: { rows: number } },
          theme: typeof plainTheme,
          keybindings: unknown,
          done: (result: T) => void,
        ) => TestWidgetComponent,
      ): Promise<T> {
        customOpenCount++;
        return await new Promise<T>((resolve) => {
          closeActiveCustom = () => resolve(undefined as T);
          activeCustom = factory(
            {
              terminal: { rows: 32 },
              requestRender(): void {
                if (activeCustom) customUpdates.push(activeCustom.render(96));
              },
            },
            plainTheme,
            {},
            resolve,
          );
          customUpdates.push(activeCustom.render(96));
        }).finally(() => {
          activeCustom = undefined;
          closeActiveCustom = undefined;
        });
      },
      setWidget(key: string, content: unknown, widgetOptions?: { placement?: string }): void {
        if (key !== "pi-workflow-running") return;
        widgetPlacement = widgetOptions?.placement;
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
  return {
    commands,
    tools,
    ctx,
    sentMessages,
    sentUserMessages,
    notifications,
    statusUpdates,
    widgetUpdates,
    customUpdates,
    widgetInstallCount: () => widgetInstallCount,
    widgetPlacement: () => widgetPlacement,
    customOpenCount: () => customOpenCount,
    closeCustom: () => closeActiveCustom?.(),
    async sessionStart(reason = "reload") {
      await Promise.all(sessionStartHandlers.map((handler) => Promise.resolve(handler({ type: "session_start", reason }, ctx))));
    },
    async command(name, args) {
      const command = commands.get(name);
      assert.ok(command);
      await command.handler(args, ctx);
      void terminalInputHandler;
    },
  };
}

export async function writeProjectWorkflow(project: string, name: string, source: string): Promise<void> {
  const workflowDir = path.join(project, ".pi", "workflows", name);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "workflow.js"), source, "utf8");
}

export async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition was not met before timeout");
}
