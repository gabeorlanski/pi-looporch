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
import type { WorkflowReviewer } from "./workflow-request.ts";
import type { WorkflowAgent, WorkflowAgentOptions, WorkflowAgentProgress } from "./workflow-runtime.ts";
import { createWorkflowTools, type WorkflowToolsOptions } from "./workflow-tools.ts";

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
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(options.cwd),
      settingsManager: SettingsManager.create(options.cwd, agentDir),
      customTools:
        options.tools ?? createPiWorkflowAgentTools(options.cwd, { agent: createPiWorkflowAgent(options), reviewer: options.reviewer }),
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
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      if (agentOptions.signal) {
        const abortSession = () => void session.abort();
        agentOptions.signal.addEventListener("abort", abortSession, { once: true });
        removeAbortListener = () => agentOptions.signal?.removeEventListener("abort", abortSession);
      }

      await session.prompt(buildAgentPrompt(prompt, agentOptions));
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      return lastAssistantText(session.messages);
    } finally {
      removeAbortListener?.();
      unsubscribe();
      session.dispose();
    }
  };
}

function buildAgentPrompt(prompt: string, options: WorkflowAgentOptions): string {
  const parts = [
    options.label ? `Workflow task label: ${options.label}` : undefined,
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

function createProgressTracker(reportProgress: (progress: WorkflowAgentProgress) => void) {
  let tokenCount = 0;
  let lastStreamUpdate = 0;
  return {
    handleEvent(event: unknown): void {
      if (!isEventObject(event)) return;
      if (event.type === "turn_start") reportProgress({ statusMessage: "thinking", tokenCount });
      if (event.type === "message_update") {
        const now = Date.now();
        if (now - lastStreamUpdate >= 250) {
          lastStreamUpdate = now;
          reportProgress({ statusMessage: "streaming", tokenCount: tokenCount + estimatedTokensFromMessage(event.message) });
        }
      }
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
        reportProgress({ statusMessage: `using ${eventToolName(event)}`, tokenCount });
      }
      if (event.type === "tool_execution_end") reportProgress({ statusMessage: `finished ${eventToolName(event)}`, tokenCount });
      if (event.type === "message_end") {
        tokenCount += workflowDisplayTokensFromMessage(event.message);
        reportProgress({ statusMessage: "thinking", tokenCount });
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
  if (typeof value !== "object" || value === null) return 0;
  const usage = (value as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return estimatedTokensFromMessage(value);
  return numericProperty(usage, "output");
}

function estimatedTokensFromMessage(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  const characters = content
    .filter((part): part is TextContentLike => isTextContent(part))
    .reduce((total, part) => total + String(part.text).length, 0);
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
