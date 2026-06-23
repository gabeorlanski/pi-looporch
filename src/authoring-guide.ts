interface AuthoringDoc {
  name: string;
  signature: string;
  docstring: string;
}

const authoringPolicy = [
  "Budget-aware workflow authoring policy:",
  "- Draft the smallest reusable runbook that satisfies the request; do not add fan-out, verifier, repair, or synthesis stages unless they materially improve quality.",
  "- Prefer paths, taskFile, cwd, concrete commands/search strategy, and explicit input/output contracts over pasted file contents or transcripts.",
  "- If a child needs code or docs, give it source-of-truth paths and tell it to read them with tools; do not embed large project files in prompts.",
  "- Pass compact summaries, structured JSON, artifact paths, counts, and evidence paths between stages; do not pass whole transcripts, full diffs, or full generated artifacts.",
  "- Bound every fan-out before launching agents: select relevant inputs first, cap optional breadth, and log skipped scope. Never map over an unbounded project tree.",
  "- Prefer compact schemas for child results: required fields, enums/booleans for status, maxLength, maxItems, and additionalProperties: false.",
  "- Use coerce or agent(..., { tools: false }) for extraction/formatting tasks that do not need coding tools.",
  "- Keep child prompts concise but self-contained: mission, exact paths, required evidence, pass/fail gates, and output contract. Do not repeat generic policy prose in every prompt.",
  "- Use verifier/repair stages only for high-risk or artifact-producing workflows; default to one voter and at most one bounded repair pass unless the user asks for deeper assurance.",
  "- Use budget.agentCount and budget.tokenCount as observed counters for optional-stage gates; never estimate tokens yourself.",
  "- Keep helper functions local and compact. Use them for repeated multi-line prompt assembly, compacting handoffs, or a named multi-step transformation; inline one-expression helpers.",
  "- For large generated outputs, route content to files. Prompts should name exact output paths and final responses should return artifactPaths plus concise summary/status.",
].join("\n");

const workflowPrimitiveExamples: Record<string, string> = {
  agent: `const outputPath = "workflow-artifacts/review-findings.json";
const finding = await agent(
  [
    "Review the file at the given path. Read it yourself from cwd; source is not pasted.",
    "Source path: " + args.file,
    "Write detailed findings to: " + outputPath,
    "Return compact JSON only: status, <=160-char summary, up to 3 findings, and artifactPaths.",
  ].join("\\n"),
  {
    label: "review " + args.file,
    taskFile: args.file,
    cwd,
    maxAttempts: 2,
    schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pass", "fail"] },
        summary: { type: "string", maxLength: 160 },
        artifactPaths: { type: "array", maxItems: 3, items: { type: "string" } },
        findings: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              line: { type: "integer", minimum: 1 },
              severity: { type: "string", enum: ["blocker", "major", "minor"] },
              message: { type: "string", maxLength: 200 },
            },
            required: ["path", "line", "severity", "message"],
            additionalProperties: false,
          },
        },
      },
      required: ["status", "summary", "artifactPaths", "findings"],
      additionalProperties: false,
    },
  },
);`,
  trace: `log("selected " + items.length + " inputs for review");
trace("selected inputs", { count: items.length, first: items[0] });`,
  coerce: `const data = await coerce({
  schema: {
    type: "object",
    properties: { title: { type: "string", maxLength: 120 } },
    required: ["title"],
    additionalProperties: false,
  },
  prompt: "Extract one compact title from: " + args.text,
  label: "extract title",
  reasoning: "minimal",
});`,
  mapreduce: `return mapreduce({
  inputPrompt: "Split this into at most 5 reviewable chunks: {{text}}",
  mapPrompt: "Review chunk {{index}}. Return compact JSON: { ok: boolean, issue?: <=120 chars }: {{item}}",
  reducePrompt: "Return a compact <=5 bullet synthesis from these compact review results: {{results}}",
  text: args.text,
  label: "review chunks",
  reasoning: "minimal",
});`,
  verifier: `return verifier({
  criteria: [{ name: "accuracy", description: "Check facts", guidelines: "Quote evidence", reasoning: "Compare claims", voters: 1 }],
  criteriaPrompt: "Evaluate {{name}} for {{artifact}} using {{guidelines}}. Return compact JSON: { pass: boolean, evidence: <=160 chars }",
  reducePrompt: "Return a compact verdict and at most 3 evidence bullets from these votes: {{votes}}",
  artifact: args.answer,
  label: "verify answer",
  reasoning: "minimal",
});`,
  renderPrompt: `const prompt = renderPrompt("review/base.txt", {
  file: args.file,
  focus: args.focus,
});
return agent(prompt, { label: "review", taskFile: args.file });`,
  readText: `const workflowPrompt = readText("@workflow/prompts/review.txt");
const workflowSchema = readJson("@workflow/schemas/finding.schema.json");
const smallFixture = readText("@workflow/fixtures/example.txt");
// For large project source, pass the path to a child agent instead of embedding readText(path) in a prompt.`,
  phase: `export default async function workflow({ topic }) {
  phase("research");
  const research = await agent("Research " + topic, { label: "research" });
  trace("research complete", { chars: String(research).length });

  phase("synthesis");
  return agent("Use this prior research:\\n\\n" + compact(research, 4000) + "\\n\\nWrite the final answer.", {
    label: "synthesis",
  });
}

function compact(value, max = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : text.slice(0, max) + "\\n… truncated";
}`,
  debug:
    "Use debug_workflow only for small workflow snippets or simple draft checks. Prefer fake agentResponses, minimal reasoning, and cheap/low-thinking model labels.",
};

const workflowPrimitiveDocs: AuthoringDoc[] = [
  {
    name: "authoring",
    signature: 'workflow_primitives({ primitive: "authoring" })',
    docstring: authoringPolicy,
  },
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
      "Marks a visible progress phase. It does not pass prior agent responses to later agents; store results and include needed prior results or compact summaries in later prompts explicitly. Traces and phase history are not child-agent context.",
  },
  {
    name: "log",
    signature: "log(message: string): void",
    docstring:
      "Adds a concise progress note to the live workflow log. Use before expensive/slow child-agent launches, after important decisions or returned artifact paths, and at visible handoff points. Avoid noisy per-item chatter and never log full generated artifacts.",
  },
  {
    name: "trace",
    signature: "trace(label: string, value?: unknown): void",
    docstring:
      "Records workflow-local debug data in snapshots and run events. Use it for selected inputs, counts, paths, artifact paths, structured handoff state, and compact summaries of child-agent results; do not trace bulky contents.",
  },
  {
    name: "agent",
    signature:
      "agent(prompt: string, options?: { label?: string, model?: string, reasoning?: string, taskFile?: string, cwd?: string, tools?: boolean, schema?: JSONSchema, maxAttempts?: number }): Promise<unknown>",
    docstring:
      "Launches a child agent with only the prompt you provide and launch metadata. Prefer source-of-truth paths, taskFile, cwd, commands/search strategy, and compact prior summaries over pasted file contents. Pass tools: false for extraction, formatting, or schema-only tasks that do not need coding tools. For artifact-producing tasks, give the child a concrete output path and require JSON with artifactPaths, summary, and status instead of full contents. When schema is provided, retries until the response is JSON that validates and returns the parsed value. Prefer compact schemas with maxLength, maxItems, enums, required fields, and additionalProperties: false.",
  },
  {
    name: "parallel",
    signature: "parallel(items, worker, { label?: string }): Promise<unknown[]>",
    docstring:
      "Runs independent work concurrently and reports fan-out progress. Use only when items do not depend on each other; select and cap the input set before launching agents.",
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
      "Runs a no-tools agent call until the response is JSON that validates against the provided JSON Schema. Use for structured extraction. Keep extraction schemas bounded with maxLength, maxItems, and additionalProperties: false.",
  },
  {
    name: "mapreduce",
    signature:
      "mapreduce({ inputPrompt, mapPrompt, reducePrompt, label?, model?, reasoning?, maxAttempts?, ...templateValues }): Promise<unknown>",
    docstring:
      "Coerces inputPrompt into { items: [] }, maps one agent per item, then runs one reduce agent. String prompts can use {{item}}, {{index}}, {{results}}, and extra template values. Select and cap items before fan-out; keep map and reduce outputs compact.",
  },
  {
    name: "verifier",
    signature: "verifier({ criteria, criteriaPrompt, reducePrompt, label?, model?, reasoning?, ...templateValues }): Promise<unknown>",
    docstring:
      "Runs one voter agent for each criterion voter and one reduction agent. Each criterion needs name, description, guidelines, reasoning, and optional voters. Prefer one voter unless deeper review is explicitly required, and keep vote/reduce outputs compact.",
  },
  {
    name: "readText / readJson",
    signature: "readText(filePath: string): string; readJson(filePath: string): unknown",
    docstring:
      "Reads files from disk. Absolute paths resolve as absolute, bare relative paths resolve from project cwd, and @workflow/... resolves inside the workflow directory. Prefer these for workflow-owned prompts, schemas, fixtures, and small deterministic inputs; do not bulk-read project source just to paste it into child prompts.",
  },
  {
    name: "renderPrompt",
    signature: "renderPrompt(templatePath: string, values: object): string",
    docstring:
      "Reads a prompt template from the workflow's prompts/ directory and substitutes {{name}} placeholders with provided values. Templates should encode concise runbook judgment and path/contract instructions, not giant repeated policy blocks.",
  },
  {
    name: "args / cwd / budget",
    signature: "args: unknown; cwd: string; budget: { agentCount: number, tokenCount: number }",
    docstring:
      "Runtime context. budget.agentCount and budget.tokenCount are observed counters for gating optional work, not pre-run estimates. Use them to skip optional fan-out/verifier/repair stages or tighten scope after expensive stages. Boundaries normalize args before execution; workflow logic should treat args as already shaped for this script. Prefer workflow(input) parameters for new workflow inputs.",
  },
];

export function workflowPrimitiveIndex(): string {
  return [
    "Workflow primitives. Ask for `authoring` before drafting a new workflow, then request only the specific primitive docs you need.",
    "Authoring headline: paths and contracts, not pasted context; compact structured outputs; artifact paths for large generated content.",
    ...workflowPrimitiveDocs.map((doc) => `- ${doc.name}: ${doc.signature}`),
    "",
    'Example: workflow_primitives({ primitive: "authoring" })',
    'Example: workflow_primitives({ primitive: "agent" })',
  ].join("\n");
}

export function workflowPrimitiveGuide(primitive?: string): string {
  if (!primitive) return workflowPrimitiveIndex();
  const selected = workflowPrimitiveDocs.filter(
    (doc) => doc.name.split(" / ").includes(primitive) || doc.signature.startsWith(`${primitive}(`),
  );
  if (!selected.length) throw new Error(`Unknown workflow primitive: ${primitive}`);
  return [
    "Workflow primitive documentation for workflow authors.",
    "Debugging tip: use debug_workflow only for small snippets/simple tasks, with fake agentResponses and minimal/low-thinking model labels.",
    "",
    workflowPrimitiveDocsText(selected),
    "",
    "Examples:",
    ...Object.entries(workflowPrimitiveExamples)
      .filter(([name]) => name === primitive || name === "debug")
      .map(([name, example]) => `- ${name}:\n${example}`),
  ].join("\n");
}

function workflowPrimitiveDocsText(docs = workflowPrimitiveDocs): string {
  return [
    "Available workflow globals:",
    ...docs.flatMap((doc) => [`- ${doc.name}`, `  Signature: ${doc.signature}`, `  Docstring: ${doc.docstring}`]),
  ].join("\n");
}
