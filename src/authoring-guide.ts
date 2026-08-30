/** Provides authoring guide behavior. */
import { readFileSync } from "node:fs";
import { renderWorkflowPrimitiveReference } from "./runtime/globals.ts";
import { defaultWorkflowDraftRoot } from "./workflow/drafts.ts";

interface DesignTopic {
  name: string;
  summary: string;
  promptFile: string;
}

const workflowDesignIndexTemplate = readFileSync(new URL("./prompts/workflow-design/index.txt", import.meta.url), "utf8").trim();

const designTopics: DesignTopic[] = [
  { name: "overview", summary: "Start here: define the outcome, stages, dataflow, and result.", promptFile: "overview.txt" },
  { name: "workflow-api", summary: "API: sandbox globals, metadata, and primitive reference.", promptFile: "workflow-api.txt" },
  { name: "draft-directory", summary: "Drafts: stage and save the complete workflow directory.", promptFile: "draft-directory.txt" },
  { name: "prompt-files", summary: "Prompts: task hierarchy, disclosure, and cache shape.", promptFile: "prompt-files.txt" },
  { name: "child-agents", summary: "Agents: task inputs, capabilities, and handoffs.", promptFile: "child-agents.txt" },
  {
    name: "structured-outputs",
    summary: "Schemas: minimal transport contracts for consumed fields.",
    promptFile: "structured-outputs.txt",
  },
  { name: "fanout", summary: "Fan-out: bounded workers and reducer manifests.", promptFile: "fanout.txt" },
  { name: "verification", summary: "Verification: risk-based gates and bounded repair.", promptFile: "verification.txt" },
  { name: "artifacts", summary: "Artifacts: durable payloads passed by path.", promptFile: "artifacts.txt" },
];

/** Provides the workflowDesignGuidance function contract. */
export function workflowDesignGuidance(topic?: string): string {
  if (!topic) return workflowDesignTopicIndex();
  const selectedTopic = designTopics.find((candidate) => candidate.name === topic);
  if (!selectedTopic) throw new Error(`Unknown workflow design guidance topic: ${topic}`);
  return renderDesignTopic(selectedTopic);
}

function workflowDesignTopicIndex(): string {
  return workflowDesignIndexTemplate.replaceAll(
    "{{topicList}}",
    designTopics.map((topic) => `- **${topic.name}** — ${topic.summary}`).join("\n"),
  );
}

function renderDesignTopic(topic: DesignTopic): string {
  const template = readFileSync(new URL(`./prompts/workflow-design/${topic.promptFile}`, import.meta.url), "utf8")
    .trim()
    .replaceAll("{{draftRoot}}", defaultWorkflowDraftRoot());
  return topic.name === "workflow-api" ? template.replaceAll("{{primitiveReference}}", renderWorkflowPrimitiveReference()) : template;
}
