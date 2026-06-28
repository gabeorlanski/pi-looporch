import type { ActiveWorkflowRuntime, WorkflowPrimitive } from "./context.ts";
import { agentPrimitive } from "./primitives/agent.ts";
import { coercePrimitive } from "./primitives/coerce.ts";
import { environmentPrimitive, filePrimitive } from "./primitives/files.ts";
import { logPrimitive } from "./primitives/log.ts";
import { mapReducePrimitive } from "./primitives/mapreduce.ts";
import { parallelPrimitive } from "./primitives/parallel.ts";
import { phasePrimitive } from "./primitives/phase.ts";
import { pipelinePrimitive } from "./primitives/pipeline.ts";
import { tracePrimitive } from "./primitives/trace.ts";
import { verifierPrimitive } from "./primitives/verifier.ts";

const workflowPrimitives: WorkflowPrimitive[] = [
  environmentPrimitive,
  agentPrimitive,
  phasePrimitive,
  logPrimitive,
  tracePrimitive,
  filePrimitive,
  parallelPrimitive,
  pipelinePrimitive,
  coercePrimitive,
  mapReducePrimitive,
  verifierPrimitive,
];

export function workflowGlobals(runtime: ActiveWorkflowRuntime, workflowDir: string): Record<string, unknown> {
  const globals: Record<string, unknown> = {};
  for (const primitive of workflowPrimitives) Object.assign(globals, primitive.globals({ runtime, workflowDir }));
  return globals;
}
