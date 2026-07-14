import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ToolDefinition, ToolInfo } from "@earendil-works/pi-coding-agent";
import piWorkflow from "../extensions/workflow.ts";

interface RegisteredTestCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

interface TestSessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload";
}

interface TestSessionShutdownEvent {
  type: "session_shutdown";
  reason: "shutdown" | "new" | "resume" | "fork" | "reload" | "quit";
}

type TestSessionStartHandler = (event: TestSessionStartEvent, ctx: ExtensionCommandContext) => Promise<void> | void;
type TestSessionShutdownHandler = (event: TestSessionShutdownEvent, ctx: ExtensionCommandContext) => Promise<void> | void;

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
  sessionId?: string;
  idle?: boolean;
  editorText?: string;
  sendMessage?: (message: SentMessage, options?: unknown) => void;
  sendUserMessage?: (message: unknown, options?: unknown) => void;
  parentTools?: ToolInfo[];
}

export interface ExtensionHarness {
  commands: Map<string, RegisteredTestCommand>;
  tools: Map<string, ToolDefinition>;
  ctx: ExtensionCommandContext;
  sentMessages: { message: SentMessage; options: unknown }[];
  sentUserMessages: { message: unknown; options: unknown }[];
  notifications: { message: string; type?: "info" | "warning" | "error" }[];
  widgetUpdates: (string[] | undefined)[];
  customUpdates: string[][];
  widgetUpdatesFor: (key: string) => (string[] | undefined)[];
  widgetInstallCount: () => number;
  widgetPlacement: () => string | undefined;
  widgetPlacementFor: (key: string) => string | undefined;
  customOpenCount: () => number;
  closeCustom: () => void;
  replaceSession: () => void;
  sessionStart: (reason?: "startup" | "reload") => Promise<void>;
  sessionShutdown: (reason?: TestSessionShutdownEvent["reason"]) => Promise<void>;
  command: (name: string, args: string) => Promise<void>;
}

export function createExtensionHarness(options: ExtensionHarnessOptions): ExtensionHarness {
  const commands = new Map<string, RegisteredTestCommand>();
  const tools = new Map<string, ToolDefinition>();
  const sentMessages: { message: SentMessage; options: unknown }[] = [];
  const sentUserMessages: { message: unknown; options: unknown }[] = [];
  const notifications: { message: string; type?: "info" | "warning" | "error" }[] = [];
  const widgetUpdates: (string[] | undefined)[] = [];
  const widgetUpdatesByKey = new Map<string, (string[] | undefined)[]>();
  const customUpdates: string[][] = [];
  let activeWidget: TestWidgetComponent | undefined;
  let activeCustom: TestWidgetComponent | undefined;
  let closeActiveCustom: (() => void) | undefined;
  let widgetInstallCount = 0;
  let customOpenCount = 0;
  let widgetPlacement: string | undefined;
  const widgetPlacements = new Map<string, string | undefined>();
  let terminalInputHandler: ((data: string) => { consume?: boolean } | undefined) | undefined;
  const sessionStartHandlers: TestSessionStartHandler[] = [];
  const sessionShutdownHandlers: TestSessionShutdownHandler[] = [];
  const sessionId = options.sessionId ?? "test-session";
  const sessionAbortController = new AbortController();
  let sessionGeneration = 0;
  const assertActiveSessionContext = (ctxGeneration: number): void => {
    if (ctxGeneration !== sessionGeneration) throw new Error("stale extension context");
  };
  const pi = {
    registerTool(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: RegisteredTestCommand): void {
      commands.set(name, command);
    },
    on(event: string, handler: unknown): void {
      if (event === "session_start") sessionStartHandlers.push(handler as TestSessionStartHandler);
      else if (event === "session_shutdown") sessionShutdownHandlers.push(handler as TestSessionShutdownHandler);
    },
    sendMessage(message: SentMessage, sendOptions?: unknown): void {
      if (options.sendMessage) {
        options.sendMessage(message, sendOptions);
        return;
      }
      sentMessages.push({ message, options: sendOptions });
    },
    sendUserMessage(message: unknown, sendOptions?: unknown): void {
      if (options.sendUserMessage) {
        options.sendUserMessage(message, sendOptions);
        return;
      }
      sentUserMessages.push({ message, options: sendOptions });
    },
    getAllTools(): ToolInfo[] {
      return options.parentTools ?? [];
    },
  } as unknown as ExtensionAPI;
  piWorkflow(pi);
  const ui = {
    notify(message: string, type?: "info" | "warning" | "error"): void {
      notifications.push({ message, type });
    },
    setStatus(): void {
      return undefined;
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
      widgetPlacements.set(key, widgetOptions?.placement);
      const keyUpdates = widgetUpdatesByKey.get(key) ?? [];
      widgetUpdatesByKey.set(key, keyUpdates);
      if (key !== "pi-workflow-running") {
        keyUpdates.push(content as string[] | undefined);
        return;
      }
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
        const rendered = activeWidget.render(72);
        widgetUpdates.push(rendered);
        keyUpdates.push(rendered);
        return;
      }
      activeWidget = undefined;
      widgetUpdates.push(content as string[] | undefined);
      keyUpdates.push(content as string[] | undefined);
    },
  };
  const createCtx = (): ExtensionCommandContext => {
    const ctxGeneration = sessionGeneration;
    return {
      get cwd() {
        assertActiveSessionContext(ctxGeneration);
        return options.cwd;
      },
      get sessionManager() {
        assertActiveSessionContext(ctxGeneration);
        return { getSessionId: () => sessionId };
      },
      get mode() {
        assertActiveSessionContext(ctxGeneration);
        return "tui";
      },
      get hasUI() {
        assertActiveSessionContext(ctxGeneration);
        return true;
      },
      get signal() {
        assertActiveSessionContext(ctxGeneration);
        return sessionAbortController.signal;
      },
      abort(): void {
        assertActiveSessionContext(ctxGeneration);
        void options.cwd;
      },
      isIdle: () => {
        assertActiveSessionContext(ctxGeneration);
        return options.idle ?? true;
      },
      get ui() {
        assertActiveSessionContext(ctxGeneration);
        return ui;
      },
    } as unknown as ExtensionCommandContext;
  };
  const ctx = createCtx();
  return {
    commands,
    tools,
    ctx,
    sentMessages,
    sentUserMessages,
    notifications,
    widgetUpdates,
    customUpdates,
    widgetUpdatesFor: (key) => widgetUpdatesByKey.get(key) ?? [],
    widgetInstallCount: () => widgetInstallCount,
    widgetPlacement: () => widgetPlacement,
    widgetPlacementFor: (key) => widgetPlacements.get(key),
    customOpenCount: () => customOpenCount,
    closeCustom: () => closeActiveCustom?.(),
    replaceSession() {
      sessionGeneration++;
    },
    async sessionStart(reason = "reload") {
      const eventCtx = createCtx();
      await Promise.all(sessionStartHandlers.map((handler) => Promise.resolve(handler({ type: "session_start", reason }, eventCtx))));
    },
    async sessionShutdown(reason = "shutdown") {
      const eventCtx = createCtx();
      await Promise.all(sessionShutdownHandlers.map((handler) => Promise.resolve(handler({ type: "session_shutdown", reason }, eventCtx))));
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

export async function waitForCondition(condition: () => boolean, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "condition was not met before timeout");
}
