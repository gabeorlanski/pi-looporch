import path from "node:path";
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
import type { WorkflowAgent, WorkflowAgentProgress } from "./runtime/types.ts";
import { createLoggedWorkflowAgentSession } from "./agent-session-logs.ts";
import { agentTaskPrompt } from "./prompt-templates.ts";
import { parseSessionTokens, workflowTokenUsageFromMessage } from "./session-usage.ts";
import { resolveWorkflowAgentCwd } from "./workflow/paths.ts";
import { readWorkflowSettings } from "./workflow/settings.ts";

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
      ? await createLoggedWorkflowAgentSession(options.cwd, effectiveCwd, agentOptions.sessionLog)
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

export { workflowAgentSessionLogDirectory } from "./session-logs.ts";
export { workflowAgentLogEvent } from "./session-events.ts";
export { parseSessionTokens } from "./session-usage.ts";

function isProjectRelativeExtensionPath(extensionPath: string): boolean {
  return extensionPath.startsWith("./") || extensionPath.startsWith("../");
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
