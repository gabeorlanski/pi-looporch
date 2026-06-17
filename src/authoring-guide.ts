interface AuthoringDoc {
  name: string;
  signature: string;
  docstring: string;
}

const workflowSourceRequirements = [
  "Start every generated workflow.js with a JSDoc block before metadata.",
  "The JSDoc must document purpose, expected args shape, phases, agent calls, file reads, and result shape.",
  "Do not import modules or use require().",
  "Export `metadata` and one default workflow function.",
  "Keep runtime logic explicit; use local helpers only when they remove real duplication or clarify a multi-step transformation.",
];

const workflowPrimitiveExamples: Record<string, string> = {
  coerce: `const data = await coerce({
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  prompt: "Extract a title from: " + args.text,
  label: "extract title",
  reasoning: "minimal",
});`,
  mapreduce: `return mapreduce({
  inputPrompt: "Split this into reviewable chunks: {{text}}",
  mapPrompt: "Review chunk {{index}}: {{item}}",
  reducePrompt: "Summarize these reviews: {{results}}",
  text: args.text,
  label: "review chunks",
  reasoning: "minimal",
});`,
  verifier: `return verifier({
  criteria: [{ name: "accuracy", description: "Check facts", guidelines: "Quote evidence", reasoning: "Compare claims", voters: 1 }],
  criteriaPrompt: "Evaluate {{name}} for {{artifact}} using {{guidelines}}",
  reducePrompt: "Summarize these votes: {{votes}}",
  artifact: args.answer,
  label: "verify answer",
  reasoning: "minimal",
});`,
  debug:
    "Use debug_workflow only for small workflow snippets or simple draft checks. Prefer fake agentResponses, minimal reasoning, and cheap/low-thinking model labels.",
};

const workflowPrimitiveDocs: AuthoringDoc[] = [
  {
    name: "metadata",
    signature: "export const metadata = { name: string, description: string }",
    docstring: "Static discovery data. name must match the workflow directory/tool name; description is shown in selection and review UI.",
  },
  {
    name: "workflow",
    signature: "export default async function workflow()",
    docstring: "Entrypoint for the workflow. Read normalized user input from args and return a JSON-serializable result.",
  },
  {
    name: "phase",
    signature: "phase(title: string): void",
    docstring: "Marks a visible progress phase. Call before each major stage so users can follow history.",
  },
  {
    name: "log",
    signature: "log(message: string): void",
    docstring: "Adds a concise progress note. Use for durable milestones, not noisy per-item chatter.",
  },
  {
    name: "agent",
    signature:
      "agent(prompt: string, options?: { label?: string, model?: string, reasoning?: string, taskFile?: string }): Promise<unknown>",
    docstring: "Launches a child agent. Always provide a meaningful label; set model/reasoning when the phase needs a specific tradeoff.",
  },
  {
    name: "parallel",
    signature: "parallel(items, worker, { label?: string }): Promise<unknown[]>",
    docstring: "Runs independent work concurrently and reports fan-out progress. Use only when items do not depend on each other.",
  },
  {
    name: "pipeline",
    signature: "pipeline(items, stages): Promise<unknown[]>",
    docstring: "Runs each item through ordered stages. Use when every item follows the same sequence.",
  },
  {
    name: "coerce",
    signature: "coerce({ schema, prompt, label?, model?, reasoning?, maxAttempts? }): Promise<unknown>",
    docstring:
      "Runs a no-tools agent call until the response is JSON that validates against the provided JSON Schema. Use for structured extraction.",
  },
  {
    name: "mapreduce",
    signature:
      "mapreduce({ inputPrompt, mapPrompt, reducePrompt, label?, model?, reasoning?, maxAttempts?, ...templateValues }): Promise<unknown>",
    docstring:
      "Coerces inputPrompt into { items: [] }, maps one agent per item, then runs one reduce agent. String prompts can use {{item}}, {{index}}, {{results}}, and extra template values.",
  },
  {
    name: "verifier",
    signature: "verifier({ criteria, criteriaPrompt, reducePrompt, label?, model?, reasoning?, ...templateValues }): Promise<unknown>",
    docstring:
      "Runs one voter agent for each criterion voter and one reduction agent. Each criterion needs name, description, guidelines, reasoning, and optional voters.",
  },
  {
    name: "readText / readJson",
    signature: "readText(relativePath: string): string; readJson(relativePath: string): unknown",
    docstring: "Reads supporting files inside the workflow directory. Paths are sandboxed to the workflow directory.",
  },
  {
    name: "args / cwd / budget",
    signature: "args: unknown; cwd: string; budget: { agentCount: number, tokenCount: number }",
    docstring:
      "Runtime context. Boundaries normalize args before execution; workflow logic should treat args as already shaped for this script.",
  },
];

export function workflowAuthoringGuide(): string {
  return [
    "Workflow source requirements:",
    ...workflowSourceRequirements.map((requirement) => `- ${requirement}`),
    "",
    workflowPrimitiveDocsText(),
  ].join("\n");
}

export function workflowPrimitiveGuide(primitive?: string): string {
  const selected = primitive
    ? workflowPrimitiveDocs.filter((doc) => doc.name.split(" / ").includes(primitive) || doc.signature.startsWith(`${primitive}(`))
    : workflowPrimitiveDocs;
  if (!selected.length) throw new Error(`Unknown workflow primitive: ${primitive ?? ""}`);
  return [
    "Workflow primitive documentation for workflow authors.",
    "Debugging tip: use debug_workflow only for small snippets/simple tasks, with fake agentResponses and minimal/low-thinking model labels.",
    "",
    workflowPrimitiveDocsText(selected),
    "",
    "Examples:",
    ...Object.entries(workflowPrimitiveExamples)
      .filter(([name]) => !primitive || name === primitive || name === "debug")
      .map(([name, example]) => `- ${name}:\n${example}`),
  ].join("\n");
}

function workflowPrimitiveDocsText(docs = workflowPrimitiveDocs): string {
  return [
    "Available workflow globals:",
    ...docs.flatMap((doc) => [`- ${doc.name}`, `  Signature: ${doc.signature}`, `  Docstring: ${doc.docstring}`]),
  ].join("\n");
}
