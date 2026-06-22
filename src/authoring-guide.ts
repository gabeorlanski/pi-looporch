interface AuthoringDoc {
  name: string;
  signature: string;
  docstring: string;
}

const workflowSourceRequirements = [
  "Document the default workflow function with JSDoc before the function declaration.",
  "The workflow function JSDoc and parameter signature are the input contract: document purpose, expected input fields, defaults, phases, agent calls, file reads, and result shape there.",
  "Put input resolution guidance in metadata.inputInstructions; do not duplicate the argument list there.",
  "List the planned runbook outline in metadata.phases; every workflow needs at least one phase with a title and optional detail.",
  "Do not import modules or use require().",
  "Export `metadata` with name, description, inputInstructions, and phases, plus one default workflow function.",
  "Lean into power-user runbook code: top-level constants, inline schemas, prompt builders, and local paths are fine when they make the workflow easier to tweak.",
  "Keep runtime logic explicit; use local helpers only when they remove real duplication or clarify a multi-step transformation.",
  "Phases are progress markers, not shared memory; pass data between phases by storing agent results and rendering them into later prompts.",
  "For file reads, use readText/readJson: absolute paths resolve as absolute, bare relative paths resolve from project cwd, and @workflow/... resolves inside the workflow directory.",
];

const childAgentPromptRequirements = [
  "Treat every child-agent prompt as a self-contained task packet: include the mission, source-of-truth files/paths, prior results that matter, and the exact artifact the child must read or write.",
  "Put durable domain context in top-level constants or prompt-builder helpers instead of scattering one-line generic prompts; repeat the relevant context in each fan-out prompt because child agents do not share memory.",
  "State non-negotiable invariants and failure gates explicitly: what must never happen, what counts as pass/fail, what evidence is required, and when to return a terminal status instead of hand-waving.",
  "Give concrete operating instructions: commands or search strategies to try, files/directories to inspect, how exhaustive to be, what to save, and how to handle missing tools or unavailable evidence without inventing facts.",
  "Define output contracts twice when useful: a JSON schema for machine handling plus prompt prose that explains the semantic meaning, allowed values, and evidence expected for each field.",
  "Use verifier/red-team/repair stages for important generated artifacts. Reviewer prompts must be adversarial, cite evidence, distinguish major measurement-breaking issues from recommendations, and feed bounded repair loops.",
  "Avoid thin prompts such as 'analyze this', 'summarize', or 'review'. A workflow is only reusable if its prompts encode the runbook judgment an expert would otherwise keep in their head.",
];

const workflowPrimitiveExamples: Record<string, string> = {
  agent: `const result = await agent("Analyze the run and return a finding object", {
  label: "analysis",
  reasoning: "medium",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" }, summary: { type: "string" } },
    required: ["ok", "summary"],
    additionalProperties: false,
  },
});`,
  trace: `trace("selected inputs", { count: items.length, first: items[0] });`,
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
  renderPrompt: `const prompt = renderPrompt("review/base.txt", {
  file: args.file,
  focus: args.focus,
});
return agent(prompt, { label: "review", reasoning: "medium" });`,
  readText: `const projectFile = readText("src/index.ts");
const workflowFixture = readJson("@workflow/fixtures/example.json");
const absoluteFile = readText(args.absolutePath);`,
  dataflow: `phase("research");
const research = await agent("Research " + args.topic, { label: "research" });

phase("synthesis");
return agent("Use this research:\\n\\n" + research + "\\n\\nWrite the final answer.", {
  label: "synthesis",
});`,
  debug:
    "Use debug_workflow only for small workflow snippets or simple draft checks. Prefer fake agentResponses, minimal reasoning, and cheap/low-thinking model labels.",
};

const workflowPrimitiveDocs: AuthoringDoc[] = [
  {
    name: "metadata",
    signature:
      "export const metadata = { name: string, description: string, inputInstructions: string, phases: { title: string, detail?: string }[] }",
    docstring:
      "Static discovery, resolver guidance, and planned runbook outline. name must match the workflow directory/tool name; description is shown in selection and review UI; inputInstructions tells the resolver how to map natural-language command input without duplicating the argument list; phases previews the expected execution shape before runtime phase() calls start.",
  },
  {
    name: "workflow",
    signature: "export default async function workflow(args) or workflow({ required, optional = default })",
    docstring:
      "Entrypoint for the workflow. Its JSDoc and parameter signature define the input contract. The runner also exposes args as a global for compatibility, but new workflows should receive input through this parameter.",
  },
  {
    name: "phase",
    signature: "phase(title: string): void",
    docstring:
      "Marks a visible progress phase. It does not pass prior agent responses to later agents; store results and include them in later prompts explicitly.",
  },
  {
    name: "log",
    signature: "log(message: string): void",
    docstring: "Adds a concise progress note. Use for durable milestones, not noisy per-item chatter.",
  },
  {
    name: "trace",
    signature: "trace(label: string, value?: unknown): void",
    docstring:
      "Records workflow-local debug data in snapshots and run events. Use it for tweakable intermediate choices, counts, and structured handoff state.",
  },
  {
    name: "agent",
    signature:
      "agent(prompt: string, options?: { label?: string, model?: string, reasoning?: string, taskFile?: string, schema?: JSONSchema, maxAttempts?: number }): Promise<unknown>",
    docstring:
      "Launches a child agent with only the prompt you provide and launch metadata. When schema is provided, retries until the response is JSON that validates and returns the parsed value. Always pass needed prior results in the prompt.",
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
    signature: "readText(filePath: string): string; readJson(filePath: string): unknown",
    docstring:
      "Reads files from disk. Absolute paths resolve as absolute, bare relative paths resolve from project cwd, and @workflow/... resolves inside the workflow directory.",
  },
  {
    name: "renderPrompt",
    signature: "renderPrompt(templatePath: string, values: object): string",
    docstring: "Reads a prompt template from the workflow's prompts/ directory and substitutes {{name}} placeholders with provided values.",
  },
  {
    name: "args / cwd / budget",
    signature: "args: unknown; cwd: string; budget: { agentCount: number, tokenCount: number }",
    docstring:
      "Runtime context. Boundaries normalize args before execution; workflow logic should treat args as already shaped for this script. Prefer workflow(input) parameters for new workflow inputs.",
  },
];

export function workflowAuthoringGuide(): string {
  return [
    "Workflow source requirements:",
    ...workflowSourceRequirements.map((requirement) => `- ${requirement}`),
    "",
    "Child-agent prompt quality requirements:",
    ...childAgentPromptRequirements.map((requirement) => `- ${requirement}`),
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
