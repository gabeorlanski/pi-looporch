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
  {
    name: "overview",
    summary: "Required first: define an explicit workflow outcome, stages, dataflow, and result.",
    promptFile: "overview.txt",
  },
  { name: "workflow-api", summary: "Exact sandbox globals and metadata requirements for workflow.js.", promptFile: "workflow-api.txt" },
  {
    name: "draft-directory",
    summary: "How to stage every workflow resource in one complete draft directory.",
    promptFile: "draft-directory.txt",
  },
  {
    name: "prompt-files",
    summary: "Required before child prompts: spell out exact task requirements in workflow-owned prompt files.",
    promptFile: "prompt-files.txt",
  },
  {
    name: "child-agents",
    summary: "How to give child agents explicit boundaries, work, deliverables, and handoffs.",
    promptFile: "child-agents.txt",
  },
  {
    name: "structured-outputs",
    summary: "How to require exact terminal structured fields without parsing assistant text.",
    promptFile: "structured-outputs.txt",
  },
  { name: "fanout", summary: "How to bound parallel work and state every worker contract.", promptFile: "fanout.txt" },
  { name: "verification", summary: "When and how to define explicit verifier and repair stages.", promptFile: "verification.txt" },
  { name: "artifacts", summary: "How to name and pass generated outputs and resource files.", promptFile: "artifacts.txt" },
];

/** Provides the workflowDesignGuidance function contract. */
export function workflowDesignGuidance(topic?: string): string {
  if (!topic) return workflowDesignTopicIndex();
  const selectedTopic = designTopics.find((candidate) => candidate.name === topic);
  if (!selectedTopic) throw new Error(`Unknown workflow design guidance topic: ${topic}`);
  return renderDesignTopic(selectedTopic);
}

function workflowDesignTopicIndex(): string {
  return workflowDesignIndexTemplate
    .replaceAll("{{topicList}}", designTopics.map((topic) => `- **${topic.name}** — ${topic.summary}`).join("\n"))
    .replaceAll("{{primitiveReference}}", renderWorkflowPrimitiveReference());
}

function renderDesignTopic(topic: DesignTopic): string {
  return readFileSync(new URL(`./prompts/workflow-design/${topic.promptFile}`, import.meta.url), "utf8")
    .trim()
    .replaceAll("{{draftRoot}}", defaultWorkflowDraftRoot())
    .replaceAll("{{primitiveReference}}", renderWorkflowPrimitiveReference());
}
