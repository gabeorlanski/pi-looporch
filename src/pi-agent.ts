import path from "node:path";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { WorkflowReviewer } from "./request.ts";
import type { WorkflowAgent, WorkflowAgentProgress, WorkflowAgentSessionLog } from "./runtime.ts";
import { createWorkflowTools, type WorkflowToolsOptions } from "./tools.ts";
import { agentTaskPrompt } from "./prompt-templates.ts";

export interface PiWorkflowAgentOptions {
  cwd: string;
  tools?: ToolDefinition[];
  reviewer?: WorkflowReviewer;
  session?: Partial<CreateAgentSessionOptions>;
}

export function createPiWorkflowAgentTools(cwd: string, workflowOptions: Omit<WorkflowToolsOptions, "cwd"> = {}): ToolDefinition[] {
  return [...(createCodingTools(cwd) as ToolDefinition[]), ...createWorkflowTools({ cwd, ...workflowOptions })];
}

export function createPiWorkflowAgent(options: PiWorkflowAgentOptions): WorkflowAgent {
  return async (prompt, agentOptions, reportProgress) => {
    const agentDir = getAgentDir();
    const authStorage = options.session?.authStorage ?? AuthStorage.create();
    const modelRegistry = options.session?.modelRegistry ?? ModelRegistry.create(authStorage);
    const model = agentOptions.model ? resolveModel(modelRegistry, agentOptions.model) : undefined;
    const loggedSession = agentOptions.sessionLog ? await createLoggedSessionManager(options.cwd, agentOptions.sessionLog) : undefined;
    const sessionManager = options.session?.sessionManager ?? loggedSession?.sessionManager;
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir,
      authStorage,
      modelRegistry,
      sessionManager: sessionManager ?? SessionManager.inMemory(options.cwd),
      settingsManager: SettingsManager.create(options.cwd, agentDir),
      customTools:
        options.tools ?? createPiWorkflowAgentTools(options.cwd, { agent: createPiWorkflowAgent(options), reviewer: options.reviewer }),
      ...options.session,
      thinkingLevel: agentOptions.reasoning ?? options.session?.thinkingLevel,
      ...(model ? { model } : {}),
    });

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
  recordEvent: (event: unknown) => void;
}

async function createLoggedSessionManager(cwd: string, sessionLog: WorkflowAgentSessionLog): Promise<LoggedSessionManager> {
  const sessionDir = workflowAgentSessionLogDirectory(cwd, sessionLog.parentId, sessionLog.agentKey);
  const eventsFile = path.join(sessionDir, "events.jsonl");
  await mkdir(sessionDir, { recursive: true });
  const sessionManager = SessionManager.create(cwd, sessionDir, { id: `workflow-agent-${String(sessionLog.agentId)}` });
  await Promise.all([
    writeFile(
      path.join(sessionDir, "metadata.json"),
      `${JSON.stringify(
        {
          ...sessionLog,
          cwd: path.resolve(cwd),
          sessionDir,
          sessionFile: sessionManager.getSessionFile(),
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
    recordEvent(event) {
      appendFileSync(eventsFile, `${JSON.stringify({ seq: ++seq, time: new Date().toISOString(), event })}\n`, "utf8");
    },
  };
}

export function workflowAgentSessionLogDirectory(
  cwd: string,
  parentId: string,
  agentKey: string,
  sessionsRoot = path.join(getAgentDir(), "sessions"),
): string {
  const projectKey = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, "")
    .replace(/[/\\:]/g, "-")}--`;
  return path.join(sessionsRoot, projectKey, parentId, agentKey);
}

function resolveModel(modelRegistry: ModelRegistry, spec: string): ReturnType<ModelRegistry["find"]> {
  const modelSpec = spec.split(":", 1)[0] ?? spec;
  const slash = modelSpec.indexOf("/");
  if (slash >= 0) return modelRegistry.find(modelSpec.slice(0, slash), modelSpec.slice(slash + 1));
  return modelRegistry.getAll().find((model) => model.id === modelSpec || model.name === modelSpec);
}

function createProgressTracker(reportProgress: (progress: WorkflowAgentProgress) => void) {
  let inputTokenCount = 0;
  let outputTokenCount = 0;
  let toolCallCount = 0;
  let lastStreamUpdate = 0;
  return {
    handleEvent(event: unknown): void {
      if (!isEventObject(event)) return;
      if (event.type === "turn_start") reportProgress(progressSnapshot("thinking", inputTokenCount, outputTokenCount, toolCallCount));
      if (event.type === "message_update") {
        const now = Date.now();
        if (now - lastStreamUpdate >= 250) {
          lastStreamUpdate = now;
          const streamingOutputTokenCount = outputTokenCount + estimatedAssistantOutputTokensFromMessage(event.message);
          reportProgress(progressSnapshot("streaming", inputTokenCount, streamingOutputTokenCount, toolCallCount));
        }
      }
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
        if (event.type === "tool_execution_start") toolCallCount++;
        reportProgress(progressSnapshot(`using ${eventToolName(event)}`, inputTokenCount, outputTokenCount, toolCallCount));
      }
      if (event.type === "tool_execution_end")
        reportProgress(progressSnapshot(`finished ${eventToolName(event)}`, inputTokenCount, outputTokenCount, toolCallCount));
      if (event.type === "message_end") {
        const usage = workflowTokenUsageFromMessage(event.message);
        inputTokenCount += usage.inputTokenCount;
        outputTokenCount += usage.outputTokenCount;
        reportProgress(progressSnapshot("thinking", inputTokenCount, outputTokenCount, toolCallCount));
      }
    },
  };
}

function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function eventToolName(event: Record<string, unknown>): string {
  return typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : "tool";
}

export function workflowDisplayTokensFromMessage(value: unknown): number {
  return workflowTokenUsageFromMessage(value).outputTokenCount;
}

function workflowTokenUsageFromMessage(value: unknown): { inputTokenCount: number; outputTokenCount: number } {
  if (typeof value !== "object" || value === null) return { inputTokenCount: 0, outputTokenCount: 0 };
  const usage = (value as { usage?: unknown }).usage;
  return {
    inputTokenCount: typeof usage === "object" && usage !== null ? numericProperty(usage, "input") : 0,
    outputTokenCount: estimatedAssistantOutputTokensFromMessage(value),
  };
}

function progressSnapshot(
  statusMessage: string,
  inputTokenCount: number,
  outputTokenCount: number,
  toolCallCount: number,
): WorkflowAgentProgress {
  return {
    statusMessage,
    inputTokenCount,
    outputTokenCount,
    toolCallCount,
    tokenCount: inputTokenCount + outputTokenCount,
  };
}

function estimatedAssistantOutputTokensFromMessage(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  const characters = content
    .filter((part): part is TextContentLike | ThinkingContentLike => isTextContent(part) || isThinkingContent(part))
    .reduce((total, part) => total + outputContentText(part).length, 0);
  return Math.ceil(characters / 4);
}

function numericProperty(value: object, key: string): number {
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "number" && Number.isFinite(property) ? property : 0;
}

interface AssistantMessageLike {
  role?: string;
  content?: unknown;
}

interface TextContentLike {
  type?: string;
  text?: unknown;
}

interface ThinkingContentLike {
  type?: string;
  thinking?: unknown;
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

function isThinkingContent(value: unknown): value is ThinkingContentLike {
  return typeof value === "object" && value !== null && (value as ThinkingContentLike).type === "thinking";
}

function outputContentText(value: TextContentLike | ThinkingContentLike): string {
  return isTextContent(value) ? String(value.text) : String(value.thinking);
}
