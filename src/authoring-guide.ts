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
  const requirementLines = workflowSourceRequirements.map((requirement) => `- ${requirement}`);
  const primitiveLines = workflowPrimitiveDocs.flatMap((doc) => [
    `- ${doc.name}`,
    `  Signature: ${doc.signature}`,
    `  Docstring: ${doc.docstring}`,
  ]);
  return ["Workflow source requirements:", ...requirementLines, "", "Available workflow globals:", ...primitiveLines].join("\n");
}
