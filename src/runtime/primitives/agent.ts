import type { WorkflowAgentOptions, WorkflowAgentProgress, WorkflowAgentSnapshot } from "../../runtime-types.ts";
import { resolveWorkflowAgentCwd } from "../../workflow-paths.ts";
import { writeWorkflowAgentOutput } from "../../workflow-outputs.ts";
import { fanOutScope, type ActiveWorkflowRuntime, type WorkflowPrimitive } from "../context.ts";
import { appendRunMessage } from "../messages.ts";
import { jsonSchemaPrompt, normalizeAttemptCount, parseAndValidateJsonResponse } from "../schema.ts";
import { cloneSerializable } from "../serialization.ts";
import { recordTrace } from "./trace.ts";

export const agentPrimitive: WorkflowPrimitive<{
  agent: (prompt: string, agentOptions?: WorkflowAgentOptions) => Promise<unknown>;
}> = {
  name: "agent",
  globals: ({ runtime }) => ({
    agent: (prompt: string, agentOptions: WorkflowAgentOptions = {}) => runAgent(runtime, prompt, agentOptions),
  }),
};

export async function runAgent(runtime: ActiveWorkflowRuntime, prompt: string, agentOptions: WorkflowAgentOptions): Promise<unknown> {
  if (agentOptions.schema === undefined) return runRawAgent(runtime, prompt, agentOptions);
  const { schema, maxAttempts, ...launchOptions } = agentOptions;
  const attempts = normalizeAttemptCount(maxAttempts, "agent");
  let validationFailure: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await runRawAgent(runtime, structuredAgentPrompt(prompt, schema, validationFailure), launchOptions);
    const validation = parseAndValidateJsonResponse(result, schema);
    if (validation.ok) return validation.value;
    validationFailure = validation.error;
    recordTrace(runtime, `${launchOptions.label ?? "agent"} schema validation failed`, { attempt, error: validationFailure });
  }
  throw new Error(`agent failed schema validation after ${String(attempts)} attempts: ${validationFailure ?? "unknown error"}`);
}

function structuredAgentPrompt(prompt: string, schema: unknown, validationFailure: string | undefined): string {
  return jsonSchemaPrompt(
    "Complete the task, then return only JSON that validates against this JSON Schema. Do not include markdown fences, commentary, or extra text outside the JSON value.",
    prompt,
    schema,
    validationFailure,
  );
}

async function runRawAgent(runtime: ActiveWorkflowRuntime, prompt: string, agentOptions: WorkflowAgentOptions): Promise<unknown> {
  if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
  const agentCwd = resolveWorkflowAgentCwd(runtime.options.cwd, agentOptions.cwd);
  const releaseAgentSlot = await runtime.agentLaunchQueue.acquire(runtime.options.signal);
  try {
    if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
    const agent: WorkflowAgentSnapshot = {
      id: runtime.snapshot.agents.length + 1,
      label: agentOptions.label ?? `agent ${String(runtime.snapshot.agents.length + 1)}`,
      phaseIndex: runtime.snapshot.phases.length,
      phase: runtime.snapshot.phases.at(-1),
      ...(agentCwd ? { cwd: agentCwd } : {}),
      model: agentOptions.model,
      reasoning: agentOptions.reasoning,
      status: "running",
      startedAt: Date.now(),
      inputTokenCount: 0,
      outputTokenCount: 0,
      toolCallCount: 0,
      stepCount: 0,
      fanOutId: fanOutScope.getStore(),
    };
    runtime.snapshot.agents.push(agent);
    appendRunMessage(runtime, {
      phaseIndex: agent.phaseIndex,
      ...(agent.phase ? { phase: agent.phase } : {}),
      agentId: agent.id,
      agentLabel: agent.label,
      level: "info",
      message: `${agent.label} started`,
    });
    runtime.emit();
    try {
      const heartbeat = setInterval(runtime.emit, 1000);
      let result: unknown;
      try {
        result = await runtime.options.agent(prompt, workflowAgentOptionsForLaunch(runtime, agent, agentOptions, agentCwd), (progress) => {
          if (!applyAgentProgress(agent, progress)) return;
          runtime.emit();
        });
      } finally {
        clearInterval(heartbeat);
      }
      if (runtime.options.signal?.aborted) throw new Error("Workflow aborted");
      agent.status = "done";
      agent.endedAt = Date.now();
      const output = cloneSerializable(result);
      agent.outputPath = runtime.options.outputsDir
        ? await writeWorkflowAgentOutput(runtime.options.outputsDir, agent.id, agent.label, output)
        : undefined;
      appendRunMessage(runtime, {
        phaseIndex: agent.phaseIndex,
        ...(agent.phase ? { phase: agent.phase } : {}),
        agentId: agent.id,
        agentLabel: agent.label,
        level: "info",
        message: `${agent.label} done`,
      });
      runtime.emit();
      return result;
    } catch (error) {
      agent.status = "error";
      agent.endedAt = Date.now();
      agent.error = error instanceof Error ? error.message : String(error);
      appendRunMessage(runtime, {
        phaseIndex: agent.phaseIndex,
        ...(agent.phase ? { phase: agent.phase } : {}),
        agentId: agent.id,
        agentLabel: agent.label,
        level: "error",
        message: `${agent.label} error: ${agent.error}`,
      });
      runtime.emit();
      throw error;
    }
  } finally {
    releaseAgentSlot();
  }
}

function applyAgentProgress(agent: WorkflowAgentSnapshot, progress: WorkflowAgentProgress): boolean {
  let changed = false;
  if (progress.statusMessage !== undefined && progress.statusMessage !== agent.message) {
    agent.message = progress.statusMessage;
    changed = true;
  }
  if (progress.inputTokenCount !== undefined && progress.inputTokenCount !== agent.inputTokenCount) {
    agent.inputTokenCount = progress.inputTokenCount;
    changed = true;
  }
  if (progress.outputTokenCount !== undefined && progress.outputTokenCount !== agent.outputTokenCount) {
    agent.outputTokenCount = progress.outputTokenCount;
    changed = true;
  }
  if (progress.toolCallCount !== undefined && progress.toolCallCount !== agent.toolCallCount) {
    agent.toolCallCount = progress.toolCallCount;
    changed = true;
  }
  if (progress.stepCount !== undefined && progress.stepCount !== agent.stepCount) {
    agent.stepCount = progress.stepCount;
    changed = true;
  }
  if (progress.model !== undefined && progress.model !== agent.model) {
    agent.model = progress.model;
    changed = true;
  }
  if (progress.sessionDir !== undefined && progress.sessionDir !== agent.sessionDir) {
    agent.sessionDir = progress.sessionDir;
    changed = true;
  }
  if (progress.sessionFile !== undefined && progress.sessionFile !== agent.sessionFile) {
    agent.sessionFile = progress.sessionFile;
    changed = true;
  }
  if (progress.eventsFile !== undefined && progress.eventsFile !== agent.eventsFile) {
    agent.eventsFile = progress.eventsFile;
    changed = true;
  }
  return changed;
}

function workflowAgentOptionsForLaunch(
  runtime: ActiveWorkflowRuntime,
  agent: WorkflowAgentSnapshot,
  agentOptions: WorkflowAgentOptions,
  agentCwd: string | undefined,
): WorkflowAgentOptions {
  const launchOptions: WorkflowAgentOptions = { ...agentOptions };
  delete launchOptions.schema;
  delete launchOptions.maxAttempts;
  if (agentCwd) launchOptions.cwd = agentCwd;
  return {
    ...launchOptions,
    ...(runtime.options.signal ? { signal: runtime.options.signal } : {}),
    ...(runtime.options.agentLogParentId
      ? {
          sessionLog: {
            parentId: runtime.options.agentLogParentId,
            agentId: agent.id,
            agentKey: workflowAgentSessionKey(agent),
            workflowName: runtime.snapshot.workflowName,
            label: agent.label,
            phaseIndex: agent.phaseIndex,
            ...(agent.phase ? { phase: agent.phase } : {}),
            ...(agent.fanOutId !== undefined ? { fanOutId: agent.fanOutId } : {}),
          },
        }
      : {}),
  };
}

function workflowAgentSessionKey(agent: WorkflowAgentSnapshot): string {
  return [
    phaseSessionSlug(agent),
    agent.fanOutId !== undefined ? `fanout-${String(agent.fanOutId).padStart(3, "0")}` : undefined,
    agentSessionSlug(agent),
  ]
    .filter((part): part is string => part !== undefined)
    .join("--");
}

function phaseSessionSlug(agent: WorkflowAgentSnapshot): string {
  const phaseLabel = agent.phase ?? (agent.phaseIndex === 0 ? "setup" : `phase-${String(agent.phaseIndex)}`);
  return `phase-${String(agent.phaseIndex).padStart(3, "0")}-${slugText(phaseLabel, 36)}`;
}

function agentSessionSlug(agent: WorkflowAgentSnapshot): string {
  return `agent-${String(agent.id).padStart(3, "0")}-${slugText(agent.label, 48)}`;
}

function slugText(value: string, maxLength: number): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength) || "unlabeled"
  );
}
