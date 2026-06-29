import type { WorkflowTraceSnapshot } from "../../runtime-types.ts";
import type { ActiveWorkflowRuntime, WorkflowPrimitive } from "../context.ts";
import { appendRunMessage } from "../messages.ts";
import { cloneSerializable } from "../serialization.ts";

export const tracePrimitive: WorkflowPrimitive<{ trace: (label: string, value?: unknown) => void }> = {
  name: "trace",
  globals: ({ runtime }) => ({ trace: (label: string, value?: unknown) => recordTrace(runtime, label, value) }),
};

export function recordTrace(runtime: ActiveWorkflowRuntime, label: string, value?: unknown): void {
  if (typeof label !== "string" || !label.trim()) throw new Error("trace label must be non-empty");
  const phase = runtime.snapshot.phases.at(-1);
  const trace: WorkflowTraceSnapshot = {
    label,
    phaseIndex: runtime.snapshot.phases.length,
    ...(phase ? { phase } : {}),
    ...(value !== undefined ? { value: traceValue(value) } : {}),
  };
  runtime.snapshot.traces.push(trace);
  appendRunMessage(runtime, {
    phaseIndex: trace.phaseIndex,
    ...(trace.phase ? { phase: trace.phase } : {}),
    level: "debug",
    message: `trace ${trace.label}${trace.value === undefined ? "" : ` ${traceValueText(trace.value)}`}`,
  });
  runtime.emit();
}

function traceValue(value: unknown): unknown {
  try {
    return cloneSerializable(value);
  } catch {
    return String(value);
  }
}

function traceValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}
