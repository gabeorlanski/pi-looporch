import { appendRunMessage } from "../messages.ts";
import type { WorkflowPrimitive } from "../context.ts";

export const phasePrimitive: WorkflowPrimitive<{ phase: (title: string) => void }> = {
  name: "phase",
  globals: ({ runtime }) => ({
    phase: (title: string) => {
      runtime.snapshot.phases.push(title);
      const phaseIndex = runtime.snapshot.phases.length;
      appendRunMessage(runtime, { phaseIndex, phase: title, level: "info", message: `phase ${title}` });
      runtime.emit();
    },
  }),
};
