import path from "node:path";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { WorkflowAgent, WorkflowAgentProgress, WorkflowAgentSessionLog } from "./runtime-types.ts";
import { agentTaskPrompt } from "./prompt-templates.ts";
import { workflowAgentSessionLogDirectory } from "./session-logs.ts";
import { resolveWorkflowAgentCwd } from "./workflow-paths.ts";
import { readWorkflowSettings } from "./workflow-settings.ts";

export interface PiWorkflowAgentOptions {
  cwd: string;
  tools?: ToolDefinition[];
  session?: Partial<CreateAgentSessionOptions>;
}

export function createWorkflowAgentResourceLoader(
  cwd: string,
  agentDir: string,
  settingsManager: SettingsManager,
  childAgentExtensions: string[] = [],
): DefaultResourceLoader {
  return new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, additionalExtensionPaths: childAgentExtensions });
}

export function resolveChildAgentExtensionPaths(projectCwd: string, childAgentExtensions: string[]): string[] {
  return childAgentExtensions.map((extensionPath) =>
    isProjectRelativeExtensionPath(extensionPath) ? path.resolve(projectCwd, extensionPath) : extensionPath,
  );
}

export function createPiWorkflowAgent(options: PiWorkflowAgentOptions): WorkflowAgent {
  return async (prompt, agentOptions, reportProgress) => {
    const agentDir = getAgentDir();
    const authStorage = options.session?.authStorage ?? AuthStorage.create();
    const modelRegistry = options.session?.modelRegistry ?? ModelRegistry.create(authStorage);
    const model = agentOptions.model ? resolveModel(modelRegistry, agentOptions.model) : undefined;
    const projectCwd = path.resolve(options.cwd);
    const effectiveCwd = resolveWorkflowAgentCwd(options.cwd, agentOptions.cwd) ?? projectCwd;
    const workflowSettings = await readWorkflowSettings(projectCwd, agentDir);
    const settingsManager = options.session?.settingsManager ?? SettingsManager.create(effectiveCwd, agentDir);
    const resourceLoader =
      options.session?.resourceLoader ??
      createWorkflowAgentResourceLoader(
        effectiveCwd,
        agentDir,
        settingsManager,
        resolveChildAgentExtensionPaths(projectCwd, workflowSettings.childAgentExtensions),
      );
    if (!options.session?.resourceLoader) await resourceLoader.reload();
    const loggedSession = agentOptions.sessionLog
      ? await createLoggedSessionManager(options.cwd, effectiveCwd, agentOptions.sessionLog)
      : undefined;
    const sessionManager = options.session?.sessionManager ?? loggedSession?.sessionManager;
    const noTools = agentOptions.tools === false ? "all" : undefined;
    const customTools = noTools
      ? []
      : (options.session?.customTools ?? options.tools ?? (createCodingTools(effectiveCwd) as ToolDefinition[]));
    const toolAllowlist = noTools ? [] : options.session?.tools;
    const { session } = await createAgentSession({
      cwd: effectiveCwd,
      agentDir,
      authStorage,
      modelRegistry,
      sessionManager: sessionManager ?? SessionManager.inMemory(effectiveCwd),
      settingsManager,
      resourceLoader,
      customTools,
      ...options.session,
      thinkingLevel: agentOptions.reasoning ?? options.session?.thinkingLevel,
      ...(model ? { model } : {}),
      tools: toolAllowlist,
      ...(noTools ? { noTools, tools: [], customTools: [] } : {}),
    });

    const sessionModel = session.model ? displayModelName(session.model) : undefined;
    if (sessionModel || loggedSession) {
      reportProgress({
        ...(sessionModel ? { model: sessionModel } : {}),
        ...(loggedSession
          ? {
              sessionDir: loggedSession.sessionDir,
              sessionFile: loggedSession.sessionFile,
              eventsFile: loggedSession.eventsFile,
            }
          : {}),
      });
    }
    const progress = createProgressTracker(reportProgress);
    const unsubscribe = session.subscribe((event) => {
      loggedSession?.recordEvent(event);
      progress.handleEvent(event);
    });

    let removeAbortListener: (() => void) | undefined;
    try {
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      if (agentOptions.signal) {
        const abortSession = () => void session.abort();
        agentOptions.signal.addEventListener("abort", abortSession, { once: true });
        removeAbortListener = () => agentOptions.signal?.removeEventListener("abort", abortSession);
      }

      await session.prompt(agentTaskPrompt(prompt, agentOptions));
      const usage = loggedSession ? parseSessionTokens(loggedSession.sessionManager.getSessionDir()) : null;
      reportProgress({
        statusMessage: "done",
        ...(usage ? { inputTokenCount: usage.input, outputTokenCount: usage.output } : {}),
      });
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      return lastAssistantText(session.messages);
    } finally {
      removeAbortListener?.();
      unsubscribe();
      session.dispose();
    }
  };
}

interface LoggedSessionManager {
  sessionManager: SessionManager;
  sessionDir: string;
  sessionFile: string;
  eventsFile: string;
  recordEvent: (event: unknown) => void;
}

async function createLoggedSessionManager(
  projectCwd: string,
  agentCwd: string,
  sessionLog: WorkflowAgentSessionLog,
): Promise<LoggedSessionManager> {
  const sessionDir = workflowAgentSessionLogDirectory(projectCwd, sessionLog.parentId, sessionLog.agentKey);
  const eventsFile = path.join(sessionDir, "events.jsonl");
  await mkdir(sessionDir, { recursive: true });
  const sessionId = `workflow-agent-${String(sessionLog.agentId)}`;
  const sessionManager = SessionManager.create(agentCwd, sessionDir, { id: sessionId });
  const sessionFile = sessionManager.getSessionFile() ?? path.join(sessionDir, `${sessionId}.jsonl`);
  await Promise.all([
    writeFile(
      path.join(sessionDir, "metadata.json"),
      `${JSON.stringify(
        {
          ...sessionLog,
          cwd: path.resolve(agentCwd),
          projectCwd: path.resolve(projectCwd),
          sessionDir,
          sessionFile,
          eventsFile,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    writeFile(eventsFile, "", "utf8"),
  ]);
  let seq = 0;
  return {
    sessionManager,
    sessionDir,
    sessionFile,
    eventsFile,
    recordEvent(event) {
      if (!isEventObject(event)) return;
      const loggedEvent = workflowAgentLogEvent(event);
      if (loggedEvent === undefined) return;
      appendFileSync(eventsFile, `${JSON.stringify({ seq: ++seq, time: new Date().toISOString(), event: loggedEvent })}\n`, "utf8");
    },
  };
}

export { workflowAgentSessionLogDirectory } from "./session-logs.ts";

function isProjectRelativeExtensionPath(extensionPath: string): boolean {
  return extensionPath.startsWith("./") || extensionPath.startsWith("../");
}

export function workflowAgentLogEvent(event: Record<string, unknown>): Record<string, unknown> | undefined {
  if (event.type === "message_update") return undefined;
  if (event.type === "message_start" || event.type === "message_end") {
    return { ...event, message: loggedMessageMetadata(event.message) };
  }
  if (event.type === "agent_end") {
    const { messages, ...metadata } = event;
    return { ...metadata, ...(Array.isArray(messages) ? { messageCount: messages.length } : {}) };
  }
  if (event.type === "turn_end") {
    const { message, toolResults, ...metadata } = event;
    return {
      ...metadata,
      message: loggedMessageMetadata(message),
      ...(Array.isArray(toolResults) ? { toolResultCount: toolResults.length } : {}),
    };
  }
  if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    return loggedToolLifecycleEvent(event);
  }
  return event;
}

function loggedToolLifecycleEvent(event: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = { type: event.type };
  for (const key of ["toolCallId", "toolName", "isError"] as const) {
    if (event[key] !== undefined) metadata[key] = event[key];
  }
  return metadata;
}

function loggedMessageMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const message = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of ["role", "usage", "api", "provider", "model", "stopReason", "timestamp", "responseId"] as const) {
    if (message[key] !== undefined) metadata[key] = message[key];
  }
  return metadata;
}

function resolveModel(modelRegistry: ModelRegistry, spec: string): ReturnType<ModelRegistry["find"]> {
  const modelSpec = spec.split(":", 1)[0] ?? spec;
  const slash = modelSpec.indexOf("/");
  if (slash >= 0) return modelRegistry.find(modelSpec.slice(0, slash), modelSpec.slice(slash + 1));
  return modelRegistry.getAll().find((model) => model.id === modelSpec || model.name === modelSpec);
}

function displayModelName(model: { name: string; provider: string; id: string }): string {
  return model.name.trim() ? model.name : `${model.provider}/${model.id}`;
}

function createProgressTracker(reportProgress: (progress: WorkflowAgentProgress) => void) {
  let inputTokenCount = 0;
  let outputTokenCount = 0;
  let toolCallCount = 0;
  let stepCount = 0;
  const report = (statusMessage?: string): void => {
    reportProgress({
      ...(statusMessage ? { statusMessage } : {}),
      inputTokenCount,
      outputTokenCount,
      toolCallCount,
      stepCount,
    });
  };
  return {
    handleEvent(event: unknown): void {
      if (!isEventObject(event)) return;
      if (event.type === "message_start") report("thinking");
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        if (event.type === "tool_execution_start") toolCallCount++;
        report("active");
      }
      if (event.type === "message_end") {
        const usage = workflowTokenUsageFromMessage(event.message);
        inputTokenCount += usage.inputTokenCount;
        outputTokenCount += usage.outputTokenCount;
        report();
      }
      if (event.type === "turn_end") {
        stepCount++;
        report("waiting");
      }
    },
  };
}

function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export function parseSessionTokens(sessionDir: string): TokenUsage | null {
  const sessionFile = findLatestSessionFile(sessionDir);
  if (!sessionFile) return null;
  try {
    let input = 0;
    let output = 0;
    for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { usage?: unknown; message?: { usage?: unknown } };
        const usage = normalizeTokenUsage(entry.usage ?? entry.message?.usage);
        if (usage) {
          input += usage.input;
          output += usage.output;
        }
      } catch {
        // Ignore malformed lines while scanning usage entries.
      }
    }
    return { input, output, total: input + output };
  } catch {
    return null;
  }
}

function workflowTokenUsageFromMessage(value: unknown): { inputTokenCount: number; outputTokenCount: number } {
  if (typeof value !== "object" || value === null) return { inputTokenCount: 0, outputTokenCount: 0 };
  const usage = normalizeTokenUsage((value as { usage?: unknown }).usage);
  return usage ? { inputTokenCount: usage.input, outputTokenCount: usage.output } : { inputTokenCount: 0, outputTokenCount: 0 };
}

function normalizeTokenUsage(value: unknown): { input: number; output: number } | null {
  if (typeof value !== "object" || value === null) return null;
  return {
    input: tokenProperty(value, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "inputTokenCount"]),
    output: tokenProperty(value, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens", "outputTokenCount"]),
  };
}

function tokenProperty(value: object, keys: string[]): number {
  const properties = value as Record<string, unknown>;
  for (const key of keys) {
    const tokenValue = properties[key];
    if (typeof tokenValue === "number" && Number.isFinite(tokenValue)) return tokenValue;
  }
  return 0;
}

function findLatestSessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  return readdirSync(sessionDir)
    .filter((file) => file.endsWith(".jsonl") && file !== "events.jsonl")
    .map((file) => path.join(sessionDir, file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}

interface AssistantMessageLike {
  role?: string;
  content?: unknown;
}

interface TextContentLike {
  type?: string;
  text?: unknown;
}

function lastAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as AssistantMessageLike | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part): part is TextContentLike => isTextContent(part))
      .map((part) => String(part.text))
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function isTextContent(value: unknown): value is TextContentLike {
  return typeof value === "object" && value !== null && (value as TextContentLike).type === "text";
}
