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
import type { LoopAgent, LoopAgentOptions, LoopAgentProgress } from "./loop-runtime.ts";

export interface PiLoopAgentOptions {
  cwd: string;
  tools?: ToolDefinition[];
  session?: Partial<CreateAgentSessionOptions>;
}

export function createPiLoopAgent(options: PiLoopAgentOptions): LoopAgent {
  return async (prompt, agentOptions, reportProgress) => {
    const agentDir = getAgentDir();
    const authStorage = options.session?.authStorage ?? AuthStorage.create();
    const modelRegistry = options.session?.modelRegistry ?? ModelRegistry.create(authStorage);
    const model = agentOptions.model ? resolveModel(modelRegistry, agentOptions.model) : undefined;
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(options.cwd),
      settingsManager: SettingsManager.create(options.cwd, agentDir),
      customTools: options.tools ?? createCodingTools(options.cwd),
      ...options.session,
      thinkingLevel: agentOptions.reasoning ?? options.session?.thinkingLevel,
      ...(model ? { model } : {}),
    });

    const progress = createProgressTracker(reportProgress);
    const unsubscribe = session.subscribe((event) => {
      progress.handleEvent(event);
    });

    let removeAbortListener: (() => void) | undefined;
    try {
      if (agentOptions.signal?.aborted) throw new Error("Loop agent aborted");
      if (agentOptions.signal) {
        const abortSession = () => void session.abort();
        agentOptions.signal.addEventListener("abort", abortSession, { once: true });
        removeAbortListener = () => agentOptions.signal?.removeEventListener("abort", abortSession);
      }

      await session.prompt(buildAgentPrompt(prompt, agentOptions));
      if (agentOptions.signal?.aborted) throw new Error("Loop agent aborted");
      return lastAssistantText(session.messages);
    } finally {
      removeAbortListener?.();
      unsubscribe();
      session.dispose();
    }
  };
}

function buildAgentPrompt(prompt: string, options: LoopAgentOptions): string {
  const parts = [
    options.label ? `Loop task label: ${options.label}` : undefined,
    options.taskFile ? `Task file: ${options.taskFile}` : undefined,
    prompt,
  ];
  return parts.filter((part): part is string => Boolean(part)).join("\n\n");
}

function resolveModel(modelRegistry: ModelRegistry, spec: string): ReturnType<ModelRegistry["find"]> {
  const modelSpec = spec.split(":", 1)[0] ?? spec;
  const slash = modelSpec.indexOf("/");
  if (slash >= 0) return modelRegistry.find(modelSpec.slice(0, slash), modelSpec.slice(slash + 1));
  return modelRegistry.getAll().find((model) => model.id === modelSpec || model.name === modelSpec);
}

function createProgressTracker(reportProgress: (progress: LoopAgentProgress) => void) {
  let toolUseCount = 0;
  let activeToolUseCount = 0;
  let tokenCount = 0;
  const filesTouched = new Set<string>();

  const emit = (statusMessage: string) => {
    reportProgress({
      statusMessage,
      toolUseCount,
      activeToolUseCount,
      filesTouched: [...filesTouched],
      tokenCount,
    });
  };

  return {
    handleEvent(event: unknown): void {
      if (!isEventObject(event)) return;
      if (event.type === "turn_start") emit("thinking");
      if (event.type === "tool_execution_start") {
        toolUseCount++;
        activeToolUseCount++;
        collectFilePaths(event.args, filesTouched);
        emit(`using ${String(event.toolName ?? "tool")}`);
      }
      if (event.type === "tool_execution_update") {
        collectFilePaths(event.args, filesTouched);
        emit(`using ${String(event.toolName ?? "tool")}`);
      }
      if (event.type === "tool_execution_end") {
        activeToolUseCount = Math.max(0, activeToolUseCount - 1);
        collectFilePaths(event.args, filesTouched);
        collectFilePaths(event.result, filesTouched);
        emit(`finished ${String(event.toolName ?? "tool")}`);
      }
      if (event.type === "message_end") {
        tokenCount += tokensFromMessage(event.message);
        emit(activeToolUseCount > 0 ? "using tools" : "thinking");
      }
    },
  };
}

function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function collectFilePaths(value: unknown, files: Set<string>): void {
  if (typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const item of value) collectFilePaths(item, files);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (isPathKey(key)) collectPathValue(child, files);
    else collectFilePaths(child, files);
  }
}

function isPathKey(key: string): boolean {
  return key === "path" || key === "file" || key === "filePath" || key === "target" || key === "taskFile" || key === "paths" || key === "files";
}

function collectPathValue(value: unknown, files: Set<string>): void {
  if (typeof value === "string" && looksLikePath(value)) files.add(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectPathValue(item, files);
  }
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes(".");
}

function tokensFromMessage(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return 0;
  const input = numericProperty(usage, "input");
  const output = numericProperty(usage, "output");
  const cacheRead = numericProperty(usage, "cacheRead");
  const cacheWrite = numericProperty(usage, "cacheWrite");
  return input + output + cacheRead + cacheWrite;
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
