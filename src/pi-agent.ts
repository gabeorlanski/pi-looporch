/** Provides pi agent behavior. */
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  availableBaseAgentToolNames,
  availableAgentExtensions,
  buildAgentCapabilityCatalog,
  parseAgentCapabilitySelection,
  resolveAgentCapabilities,
  resolveAgentExtensionSelectors,
  type AgentCapabilityCatalog,
  type AgentCapabilityResolutionDiagnostic,
  type AgentCapabilityCatalogProvider,
} from "./pi-agent-capabilities.ts";
import type { WorkflowAgent, WorkflowAgentReporter, WorkflowToolActivitySnapshot } from "./runtime/types.ts";
import { createLoggedWorkflowAgentSession } from "./agent-session-logs.ts";
import { agentTaskPrompt } from "./prompt-templates.ts";
import { parseSessionTokens, workflowTokenUsageFromMessage } from "./session-usage.ts";
import { createStructuredOutput } from "./structured-output.ts";
import { resolveWorkflowAgentCwd } from "./workflow/paths.ts";
import { readWorkflowSettings } from "./workflow/settings.ts";
import { resolveWorkflowModel } from "./model-selection.ts";

export interface PiWorkflowAgentOptions {
  cwd: string;
  tools?: ToolDefinition[];
  session?: Partial<CreateAgentSessionOptions>;
  /** Parent-session capability metadata; avoids initializing extension factories for discovery. */
  agentCapabilityCatalog?: AgentCapabilityCatalogProvider;
  /** External Pi SDK session factory; overridden only by deterministic adapter tests. */
  createSession?: typeof createAgentSession;
}

/** Provides the createPiWorkflowAgent function contract. */
export function createPiWorkflowAgent(options: PiWorkflowAgentOptions): WorkflowAgent {
  return async (prompt, agentOptions, reporter) => {
    const agentDir = getAgentDir();
    const modelRuntime =
      options.session?.modelRuntime ??
      (await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json") }));
    const model = agentOptions.model ? resolveWorkflowModel(modelRuntime.getModels(), agentOptions.model) : undefined;
    const projectCwd = path.resolve(options.cwd);
    const effectiveCwd = resolveWorkflowAgentCwd(options.cwd, agentOptions.cwd) ?? projectCwd;
    const workflowSettings = await readWorkflowSettings(projectCwd, agentDir);
    const settingsManager = options.session?.settingsManager ?? SettingsManager.create(effectiveCwd, agentDir);
    const capabilitySettingsManager = SettingsManager.create(projectCwd, agentDir);
    const structuredOutput = agentOptions.schema === undefined ? undefined : createStructuredOutput(agentOptions.schema);
    const customTools = [
      ...(options.session?.customTools ?? options.tools ?? []),
      ...(structuredOutput === undefined ? [] : [structuredOutput.tool]),
    ];
    const extensionSelection = parseAgentCapabilitySelection(
      agentOptions.extensions ?? workflowSettings.childAgentExtensions,
      "extensions",
    );
    const toolSelection = parseAgentCapabilitySelection(agentOptions.tools ?? workflowSettings.childAgentTools, "tools");
    const shapeDiagnostics = [
      ...(extensionSelection.ok ? [] : extensionSelection.diagnostics),
      ...(toolSelection.ok ? [] : toolSelection.diagnostics),
    ];
    if (!extensionSelection.ok || !toolSelection.ok) throw new Error(renderRuntimeCapabilityDiagnostics(shapeDiagnostics));
    const capabilityExtensions = extensionSelection.selection;
    const capabilityTools = toolSelection.selection;
    const baseToolNames = availableBaseAgentToolNames(effectiveCwd);
    const customToolNames = customTools.map((tool) => tool.name);
    const explicitSelectors = capabilityExtensions === "all" ? [] : capabilityExtensions;
    let catalog: AgentCapabilityCatalog | undefined = options.agentCapabilityCatalog
      ? await options.agentCapabilityCatalog({ extensionSelectors: explicitSelectors })
      : undefined;
    if (!catalog) {
      const resolvedSelectors = await resolveAgentExtensionSelectors({
        cwd: projectCwd,
        agentDir,
        settingsManager: capabilitySettingsManager,
        selectors: explicitSelectors,
      });
      const knownToolNames = new Set([...baseToolNames, ...customToolNames]);
      const loadAmbientExtensions =
        capabilityExtensions === "all" || (capabilityTools !== "all" && capabilityTools.some((toolName) => !knownToolNames.has(toolName)));
      const discoveryLoader =
        options.session?.resourceLoader ??
        new DefaultResourceLoader({
          cwd: projectCwd,
          agentDir,
          settingsManager: capabilitySettingsManager,
          noExtensions: !loadAmbientExtensions,
          additionalExtensionPaths: resolvedSelectors.paths,
        });
      if (!options.session?.resourceLoader) await discoveryLoader.reload();
      const discovered = discoveryLoader.getExtensions();
      catalog = buildAgentCapabilityCatalog({
        availableExtensions: availableAgentExtensions(discovered.extensions, resolvedSelectors.selectorsByPath),
        baseToolNames,
        customToolNames,
        loadErrors: discovered.errors.map((error) => ({
          ...error,
          selectors: resolvedSelectors.selectorsByPath.get(error.path) ?? [],
        })),
      });
    }
    const resolvedCapabilities = resolveAgentCapabilities({
      extensions: capabilityExtensions,
      tools: capabilityTools,
      catalog,
    });
    if (!resolvedCapabilities.ok) throw new Error(renderRuntimeCapabilityDiagnostics(resolvedCapabilities.diagnostics));
    const resourceLoader = new DefaultResourceLoader({
      cwd: projectCwd,
      agentDir,
      settingsManager: capabilitySettingsManager,
      noExtensions: true,
      additionalExtensionPaths: resolvedCapabilities.extensionPaths,
    });
    await resourceLoader.reload();
    const loadErrors = resourceLoader.getExtensions().errors;
    if (loadErrors.length > 0) {
      throw new Error(`Child agent extensions failed to load:\n${loadErrors.map((error) => `- ${error.path}: ${error.error}`).join("\n")}`);
    }
    const loggedSession = agentOptions.sessionLog
      ? await createLoggedWorkflowAgentSession(options.cwd, effectiveCwd, agentOptions.sessionLog)
      : undefined;
    const sessionManager = options.session?.sessionManager ?? loggedSession?.sessionManager;
    const { session } = await (options.createSession ?? createAgentSession)({
      cwd: effectiveCwd,
      agentDir,
      sessionManager: sessionManager ?? SessionManager.inMemory(effectiveCwd),
      settingsManager,
      ...options.session,
      modelRuntime,
      resourceLoader,
      customTools,
      thinkingLevel: agentOptions.reasoning ?? options.session?.thinkingLevel,
      ...(model ? { model } : {}),
      tools:
        structuredOutput === undefined || resolvedCapabilities.toolNames === undefined
          ? resolvedCapabilities.toolNames
          : [...new Set([...resolvedCapabilities.toolNames, structuredOutput.tool.name])],
    });

    const sessionModel = session.model
      ? session.model.name.trim()
        ? session.model.name
        : `${session.model.provider}/${session.model.id}`
      : undefined;
    const sessionPrompt = agentTaskPrompt(prompt, agentOptions);
    reporter.launched({ prompt: sessionPrompt });
    reporter.progress({
      ...(sessionModel ? { model: sessionModel } : {}),
      ...(loggedSession
        ? {
            sessionDir: loggedSession.sessionDir,
            sessionFile: loggedSession.sessionFile,
            eventsFile: loggedSession.eventsFile,
          }
        : {}),
    });
    const progress = createWorkflowAgentProgressTracker(reporter);
    const unsubscribe = session.subscribe((event) => {
      loggedSession?.recordEvent(event);
      progress.handleEvent(event);
    });

    let removeAbortListener: (() => void) | undefined;
    try {
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      if (agentOptions.signal) {
        const abortSession = (): void => void session.abort();
        agentOptions.signal.addEventListener("abort", abortSession, { once: true });
        removeAbortListener = () => agentOptions.signal?.removeEventListener("abort", abortSession);
      }

      await session.prompt(sessionPrompt);
      const loggedUsage = loggedSession ? parseSessionTokens(loggedSession.sessionManager.getSessionDir()) : null;
      const sessionStats = session.getSessionStats();
      reporter.progress({
        statusMessage: "done",
        ...(loggedUsage
          ? {
              inputTokenCount: loggedUsage.input,
              cacheReadTokenCount: loggedUsage.cacheRead,
              outputTokenCount: loggedUsage.output,
            }
          : {
              inputTokenCount: sessionStats.tokens.input,
              cacheReadTokenCount: sessionStats.tokens.cacheRead,
              outputTokenCount: sessionStats.tokens.output,
            }),
        cost:
          typeof sessionStats.cost === "number" && Number.isFinite(sessionStats.cost)
            ? { knownUsd: sessionStats.cost, complete: true }
            : (loggedUsage?.cost ?? { knownUsd: 0, complete: false }),
      });
      if (agentOptions.signal?.aborted) throw new Error("Workflow agent aborted");
      const failure = workflowAgentFailureMessage(session.messages, agentOptions.label);
      if (failure) throw new Error(failure);
      const result = structuredOutput?.result();
      if (agentOptions.schema !== undefined && result === undefined)
        throw new Error("Schema-enabled workflow child agents must finish by calling StructuredOutput");
      const usage = sessionStats.tokens;
      return {
        ...(result ?? {}),
        message:
          typeof result?.message === "string"
            ? result.message
            : agentOptions.schema === undefined
              ? lastAssistantText(session.messages)
              : null,
        name: agentOptions.label ?? "agent",
        steps: progress.steps(),
        usage,
      };
    } finally {
      removeAbortListener?.();
      unsubscribe();
      session.dispose();
    }
  };
}

function renderRuntimeCapabilityDiagnostics(diagnostics: readonly AgentCapabilityResolutionDiagnostic[]): string {
  return [
    "Invalid child agent capabilities:",
    ...diagnostics.map((diagnostic) => {
      const index = diagnostic.index === undefined ? "" : `[${String(diagnostic.index)}]`;
      const value = diagnostic.value === undefined ? "" : ` ${JSON.stringify(diagnostic.value)}`;
      return `- ${diagnostic.capability}${index}${value}: ${diagnostic.reason}`;
    }),
  ].join("\n");
}

export { workflowAgentSessionLogDirectory } from "./session-logs.ts";
export { workflowAgentLogEvent } from "./session-events.ts";
export { parseSessionTokens } from "./session-usage.ts";

/** Deterministic tracker for translating Pi child-agent session events into workflow progress snapshots. */
export interface WorkflowAgentProgressTracker {
  /** Applies one Pi session event and emits progress when it changes child-agent runtime state. */
  handleEvent(event: unknown): void;
  /** Number of completed model turns observed in this session. */
  steps(): number;
}

/** Creates a deterministic Pi session event tracker that reports workflow child-agent progress snapshots. */
export function createWorkflowAgentProgressTracker(reporter: WorkflowAgentReporter): WorkflowAgentProgressTracker {
  let inputTokenCount = 0;
  let cacheReadTokenCount = 0;
  let outputTokenCount = 0;
  let costUsd = 0;
  let costComplete = true;
  let costObserved = false;
  let toolCallCount = 0;
  let stepCount = 0;
  const toolActivity: WorkflowToolActivitySnapshot[] = [];
  const report = (statusMessage?: string): void => {
    reporter.progress({
      ...(statusMessage ? { statusMessage } : {}),
      inputTokenCount,
      cacheReadTokenCount,
      outputTokenCount,
      cost: { knownUsd: costUsd, complete: costObserved && costComplete },
      toolCallCount,
      toolActivity: toolActivity.map((tool) => ({ ...tool })),
      stepCount,
    });
  };
  return {
    handleEvent(event: unknown): void {
      if (!isEventObject(event)) return;
      if (event.type === "message_start") report("thinking");
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        if (event.type === "tool_execution_start") {
          toolCallCount++;
          toolActivity.push(toolActivitySnapshot(event));
        }
        report("active");
      }
      if (event.type === "message_end") {
        const usage = workflowTokenUsageFromMessage(event.message);
        inputTokenCount += usage.inputTokenCount;
        cacheReadTokenCount += usage.cacheReadTokenCount;
        outputTokenCount += usage.outputTokenCount;
        if (usage.costUsd === undefined) costComplete = false;
        else {
          costUsd += usage.costUsd;
          costObserved = true;
        }
        report();
      }
      if (event.type === "turn_end") {
        stepCount++;
        report("waiting");
      }
    },
    steps: () => stepCount,
  };
}

function toolActivitySnapshot(event: Record<string, unknown>): WorkflowToolActivitySnapshot {
  const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
  const argumentsValue = event.args ?? event.arguments ?? event.input;
  if (argumentsValue === undefined) return { name: toolName };
  return { name: toolName, arguments: argumentsValue };
}

function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Returns the actionable provider failure from a child session's final assistant response, when present. */
export function workflowAgentFailureMessage(messages: unknown[], label?: string): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as AssistantMessageLike | undefined;
    if (message?.role !== "assistant") continue;
    if (message.stopReason !== "error") return undefined;
    const prefix = label ? `Workflow child agent ${JSON.stringify(label)} failed` : "Workflow child agent failed";
    const errorMessage = message.errorMessage?.trim() ?? "provider returned an error response without details";
    return `${prefix}: ${errorMessage}`;
  }
  return undefined;
}

interface AssistantMessageLike {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
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
