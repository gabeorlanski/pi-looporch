import { readFileSync } from "node:fs";
import { renderWorkflowPrimitiveReference } from "./runtime/globals.ts";
import { defaultWorkflowDraftRoot } from "./workflow/drafts.ts";

interface DesignTopic {
  name: string;
  summary: string;
  promptFile: string;
}

const designTopics: DesignTopic[] = [
  { name: "overview", summary: "Shortest path for deciding whether and how to author a workflow.", promptFile: "overview.txt" },
  { name: "workflow-api", summary: "Sandbox globals and metadata contract for workflow.js.", promptFile: "workflow-api.txt" },
  {
    name: "draft-directory",
    summary: "How to stage generated workflows with resources for saving.",
    promptFile: "draft-directory.txt",
  },
  { name: "prompt-files", summary: "How to keep child-agent prompts in workflow-owned prompt files.", promptFile: "prompt-files.txt" },
  {
    name: "child-agents",
    summary: "How to launch child agents with clear boundaries and compact handoffs.",
    promptFile: "child-agents.txt",
  },
  {
    name: "structured-outputs",
    summary: "How to require compact JSON without filling the route prompt with schemas.",
    promptFile: "structured-outputs.txt",
  },
  { name: "fanout", summary: "How to use parallelism without launching unbounded agents.", promptFile: "fanout.txt" },
  { name: "verification", summary: "When to add verifier/repair stages.", promptFile: "verification.txt" },
  { name: "artifacts", summary: "How to handle large generated outputs and resource files.", promptFile: "artifacts.txt" },
];

export function workflowDesignGuidance(topic?: string): string {
  if (!topic) return workflowDesignTopicIndex();
  const selectedTopic = designTopics.find((candidate) => candidate.name === topic);
  if (!selectedTopic) throw new Error(`Unknown workflow design guidance topic: ${topic}`);
  return renderDesignTopic(selectedTopic);
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

function renderDesignTopic(topic: DesignTopic): string {
  return readFileSync(new URL(`./prompts/workflow-design/${topic.promptFile}`, import.meta.url), "utf8")
    .trim()
    .replaceAll("{{draftRoot}}", defaultWorkflowDraftRoot())
    .replaceAll("{{primitiveReference}}", renderWorkflowPrimitiveReference());
}
