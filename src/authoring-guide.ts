import { renderWorkflowPrimitiveReference } from "./runtime/globals.ts";
import { defaultWorkflowDraftRoot } from "./workflow/drafts.ts";

interface DesignTopic {
  name: string;
  summary: string;
  guidance: string[];
  examples?: string[];
}

const designTopics: DesignTopic[] = [
  {
    name: "overview",
    summary: "Shortest path for deciding whether and how to author a workflow.",
    guidance: [
      "Use an existing workflow when one fits; author a new workflow only when the request is reusable or multi-step enough to deserve a runbook.",
      "Before asking about missing purpose or contract details, inspect relevant project context and infer the workflow purpose, inputs/defaults, phases, child-agent roles, file reads, and result shape when they are reasonably clear.",
      `Draft the workflow under the default outside-project draft root ${defaultWorkflowDraftRoot()}, then call propose_workflow with the workflow name.`,
      "Keep workflow.js as orchestration code. Put reusable child-agent prompt text in prompts/*.txt and render it with renderPrompt(...).",
      "Ask this tool for narrower topics only when needed: workflow-api, draft-directory, prompt-files, child-agents, structured-outputs, fanout, verification, artifacts.",
      "The supported workflow primitives are listed below from the runtime registry so this guide stays synchronized with implementation.",
    ],
  },
  {
    name: "workflow-api",
    summary: "Sandbox globals and metadata contract for workflow.js.",
    guidance: [
      "workflow.js exports static metadata and a default async workflow function; metadata must include name, description, inputInstructions, and phases.",
      "Document the default function with JSDoc covering purpose, input fields/defaults, phases, child agents, file reads, and result shape.",
      "Supported workflow primitives are rendered below from the runtime registry with short descriptions and signatures; call narrower guidance topics for examples only when needed.",
      "Receive workflow input through workflow({ field, optional = default }) parameters.",
      "Workflows cannot import modules or use ambient Node globals. Use readText/readJson/writeText/writeJson/renderPrompt for workflow-owned files and artifacts.",
    ],
    examples: [
      `export const metadata = {\n  name: "review",\n  description: "Review selected files",\n  inputInstructions: "Resolve files from explicit path mentions; use remaining prose as focus.",\n  phases: [{ title: "review" }, { title: "synthesis" }],\n};`,
    ],
  },
  {
    name: "draft-directory",
    summary: "How to stage generated workflows with resources for saving.",
    guidance: [
      "Create a complete draft directory with workflow.js plus workflow-owned prompts, schemas, fixtures, or examples before proposing.",
      `Use ${defaultWorkflowDraftRoot()}/<workflow-name>/ by default so workflow authoring does not dirty the worktree.`,
      "Call propose_workflow with the workflow name. Omit draftDir when using the default draft directory; otherwise set draftDir to the directory path, not the workflow.js file path.",
      "Drafts copy to .pi/workflows/<name>/ so workflow.js and resources land together.",
    ],
    examples: [
      `${defaultWorkflowDraftRoot()}/review/\n  workflow.js\n  prompts/review.txt\n  prompts/synthesize.txt\n  schemas/finding.schema.json`,
      `propose_workflow({ name: "review" })`,
    ],
  },
  {
    name: "prompt-files",
    summary: "How to keep child-agent prompts in workflow-owned prompt files.",
    guidance: [
      "Put reusable child-agent prompts under prompts/*.txt; use subdirectories when a workflow has several phases.",
      "If a workflow needs more than five distinct non-verifier prompts, split them into separate prompt files instead of packing variants into workflow.js or one oversized template.",
      "Call renderPrompt(templatePath, values) from workflow.js. Template paths resolve inside the workflow prompts/ directory.",
      "Prompt files may include shared context, but shape it as a compact contract with sections like Inputs, Purpose, Definitions, Rules, Task, and Output.",
      "Keep the Inputs section intentionally small: include only values this stage directly consumes, not every workflow input or global. Move stable rules to Rules/Definitions and pass paths, IDs, counts, or compact summaries instead of full objects.",
      "Use renderPrompt placeholders such as {{file}}, {{focus}}, {{outputPath}}, and {{priorSummary}}; do not write JS template variables like ${input.file} inside prompt files.",
      "Avoid unstructured global preamble dumps and repeated irrelevant globals. Include only the shared context that child stage needs.",
      "Keep tiny inline prompts only for glue such as one-line synthesis labels.",
    ],
    examples: [
      `Inputs:\n- File: {{file}}\n- Focus: {{focus}}\n\nPurpose:\nReview the externally meaningful behavior for this stage.\n\nRules:\n- Cite evidence with file paths and lines.\n- Preserve observable behavior; do not restate every source detail.\n\nTask:\nRead the source file and write findings to {{outputPath}}.\n\nOutput:\nReturn compact JSON with status, summary, and artifactPaths.`,
      `const prompt = renderPrompt("review/file.txt", { file, focus, outputPath });\nconst result = await agent(prompt, { label: "review " + file, taskFile: file, cwd });`,
    ],
  },
  {
    name: "child-agents",
    summary: "How to launch child agents with clear boundaries and compact handoffs.",
    guidance: [
      "Give child agents source-of-truth paths and tell them to read files with tools; do not paste large project files into prompts.",
      "Use taskFile for the primary file, cwd for alternate/scratch directories, and tools: false for extraction or formatting tasks that do not need tools.",
      "Pass only compact prior results, artifact paths, counts, and evidence paths between stages.",
      "Return compact status, summaries, and artifact paths; large results belong in files, not parent-session prompts.",
      "Use log(...) before slow launches and at handoffs; use trace(...) for structured debug state such as selected files, output paths, and compact summaries.",
    ],
  },
  {
    name: "structured-outputs",
    summary: "How to require compact JSON without filling the route prompt with schemas.",
    guidance: [
      "Prefer agent(prompt, { schema, maxAttempts }) when a child agent must do tool work and return typed data.",
      "Use coerce(...) for no-tool extraction/normalization tasks.",
      "Keep schemas small: required fields, short keys, enums/booleans, maxLength, maxItems, and additionalProperties: false.",
      "Use JSON as the control surface only: status, decision, IDs, counts, short summary, artifactPaths, evidence paths, and line references.",
      "Route large reasoning, transcripts, diffs, reports, and generated artifacts to named files; return their paths and a compact manifest.",
      "For large lists, prefer capped summaries or JSONL/artifact files over one giant nested JSON object.",
      "Stage expansion: first return a compact selector/manifest, then launch follow-up agents only for selected items that need detail.",
      "Use stable IDs and lookup tables instead of repeating long strings across every finding.",
    ],
    examples: [
      `const schema = {\n  type: "object",\n  properties: { status: { type: "string", enum: ["pass", "fail"] }, summary: { type: "string", maxLength: 160 } },\n  required: ["status", "summary"],\n  additionalProperties: false,\n};`,
    ],
  },
  {
    name: "fanout",
    summary: "How to use parallelism without launching unbounded agents.",
    guidance: [
      "Select and cap inputs before fan-out; never map over an unbounded project tree.",
      "Use parallel(items, worker, { label }) only when items are independent.",
      "Use pipeline(items, stages) when every item follows the same ordered stages.",
      "Record skipped scope with log(...) or trace(...) so users can see what was intentionally left out.",
      "Workflow runs obey the project maxParallelAgents cap; design fan-outs as bounded queues, not bursts.",
    ],
  },
  {
    name: "verification",
    summary: "When to add verifier/repair stages.",
    guidance: [
      "Add verification only for high-risk, user-visible, or artifact-producing workflows; do not add it by default.",
      "Prefer one verifier voter and at most one bounded repair pass unless the user explicitly asks for stronger assurance.",
      "Verifier prompts should cite evidence and separate major correctness failures from recommendations.",
      "Skip optional verification when budget.agentCount or budget.tokenCount shows the run is already expensive; these are observed counters, not estimates.",
    ],
  },
  {
    name: "artifacts",
    summary: "How to handle large generated outputs and resource files.",
    guidance: [
      "Route large generated content to files; prompts should name exact output paths.",
      "Final results should include artifactPaths plus concise status/summary, not full file contents.",
      "Use @workflow/... with readText/readJson for workflow-owned prompts, schemas, fixtures, and small deterministic inputs; use writeText/writeJson for artifacts and manifests that later stages should read by path.",
      "Avoid bulk-reading project source just to paste it into a prompt; pass paths instead.",
    ],
  },
];

export function workflowDesignGuidance(topic?: string): string {
  if (!topic) return workflowDesignTopicIndex();
  const selectedTopic = designTopics.find((candidate) => candidate.name === topic);
  if (!selectedTopic) throw new Error(`Unknown workflow design guidance topic: ${topic}`);
  return workflowDesignTopicText(selectedTopic);
}

function workflowDesignTopicIndex(): string {
  return [
    "Workflow design guidance. Call with a topic for concise, task-specific help while authoring workflows.",
    "Start with topic: overview. Use topic: workflow-api for primitive syntax and sandbox rules.",
    "Topics:",
    ...designTopics.map((topic) => `- ${topic.name}: ${topic.summary}`),
    "",
    renderWorkflowPrimitiveReference(),
  ].join("\n");
}

function workflowDesignTopicText(topic: DesignTopic): string {
  return [
    `Workflow design guidance: ${topic.name}`,
    topic.summary,
    "",
    "Guidance:",
    ...topic.guidance.map((line) => `- ${line}`),
    ...(topic.examples?.length ? ["", "Examples:", ...topic.examples] : []),
    ...(topic.name === "overview" || topic.name === "workflow-api" ? ["", renderWorkflowPrimitiveReference()] : []),
  ].join("\n");
}
