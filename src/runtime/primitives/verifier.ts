import type { ActiveWorkflowRuntime, VerifierCriterion, VerifierOptions, WorkflowPrimitive } from "../context.ts";
import { renderPromptTemplate } from "../prompts.ts";
import { runAgent } from "./agent.ts";
import { runParallel } from "./parallel.ts";

export const verifierPrimitive: WorkflowPrimitive<{ verifier: (options: VerifierOptions) => Promise<unknown> }> = {
  name: "verifier",
  docs: [
    {
      name: "verifier",
      signature: "verifier({ criteria, criteriaPrompt, reducePrompt, extensions?, tools?, ...context })",
      summary: "Runs criterion voter child agents followed by a reducer for adversarial review or validation workflows.",
    },
  ],
  globals: ({ runtime }) => ({ verifier: (options: VerifierOptions) => verifyWithAgents(runtime, options) }),
};

async function verifyWithAgents(runtime: ActiveWorkflowRuntime, options: VerifierOptions): Promise<unknown> {
  const {
    criteria: rawCriteria,
    criteriaPrompt,
    reducePrompt,
    label: labelOption,
    model,
    reasoning,
    extensions,
    tools,
    ...context
  } = options;
  const label = typeof labelOption === "string" && labelOption.trim() ? labelOption : "verifier";
  const criteria = normalizeVerifierCriteria(rawCriteria);
  const voterInputs = criteria.flatMap((criterion) =>
    Array.from({ length: criterion.voters }, (_value, voterIndex) => ({ criterion, voter: voterIndex + 1 })),
  );
  const votes = await runParallel(
    runtime,
    voterInputs,
    ({ criterion, voter }) =>
      runAgent(runtime, renderPromptTemplate(criteriaPrompt, { ...context, ...criterion, criterion, voter, criteria }), {
        label: `${label} ${criterion.name} voter ${String(voter)}`,
        model,
        reasoning,
        extensions,
        tools,
      }),
    `${label} voters`,
  );
  return runAgent(runtime, renderPromptTemplate(reducePrompt, { ...context, criteria, votes }), {
    label: `${label} reduce`,
    model,
    reasoning,
    extensions,
    tools,
  });
}

function normalizeVerifierCriteria(criteria: unknown): VerifierCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error("verifier criteria must be a non-empty array");
  return criteria.map((criterion, index) => {
    if (typeof criterion !== "object" || criterion === null) throw new Error(`verifier criteria[${String(index)}] must be an object`);
    const candidate = criterion as Record<string, unknown>;
    const voters = candidate.voters ?? 1;
    for (const key of ["name", "description", "guidelines", "reasoning"]) {
      if (typeof candidate[key] !== "string" || !candidate[key].trim())
        throw new Error(`verifier criteria[${String(index)}].${key} must be a non-empty string`);
    }
    if (typeof voters !== "number" || !Number.isInteger(voters) || voters < 1)
      throw new Error(`verifier criteria[${String(index)}].voters must be a positive integer`);
    return { ...candidate, voters } as VerifierCriterion;
  });
}
