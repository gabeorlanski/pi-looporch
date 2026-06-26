import type { OutlinePrompt, OutlineSection, OutlineStage, OutlineStageKind, WorkflowOutline } from "../workflow-outline.ts";

export interface WorkflowFlowchartOptions {
  filePaths?: readonly string[];
  maxLines?: number;
}

const MODEL_BEARING_KINDS = new Set<OutlineStageKind>(["agent", "coerce", "mapreduce", "verifier"]);

export function workflowFlowchartLines(outline: WorkflowOutline, options: WorkflowFlowchartOptions = {}): string[] {
  const lines = ["start"];
  const sections = outline.sections.length ? outline.sections : metadataPhaseSections(outline);
  sections.forEach((section, sectionIndex) => {
    if (section.phase !== undefined) lines.push("  ↓", `phase: ${phaseLabel(outline, section.phase)}`);
    if (section.stages.length === 0) lines.push("  └─ no executable stages found by static review");
    section.stages.forEach((stage, stageIndex) =>
      pushStageLines(lines, stage, "  ", stageIndex === section.stages.length - 1, stageIndex + 1, section.stages.length),
    );
    if (sectionIndex < sections.length - 1) lines.push("  ↓");
  });
  lines.push("  ↓", `save: .pi/workflows/${outline.metadata.name || "<workflow>"}/ (${fileSummary(options.filePaths ?? [])})`);
  return capLines(lines, options.maxLines);
}

function capLines(lines: string[], maxLines: number | undefined): string[] {
  if (maxLines === undefined || lines.length <= maxLines || maxLines < 4) return lines;
  return [...lines.slice(0, maxLines - 2), `… ${String(lines.length - maxLines + 1)} more flow line(s)`, lines[lines.length - 1]];
}

function metadataPhaseSections(outline: WorkflowOutline): OutlineSection[] {
  return outline.metadata.phases.map((phase, index) => ({ id: `metadata-phase-${String(index + 1)}`, phase: phase.title, stages: [] }));
}

function pushStageLines(lines: string[], stage: OutlineStage, prefix: string, last: boolean, index: number, siblingCount: number): void {
  const connector = siblingCount > 1 ? (last ? "└─" : "├─") : "└─";
  const sequence = siblingCount > 1 ? `${String(index)}. ` : "";
  lines.push(`${prefix}${connector} ${sequence}${stageLabel(stage)}`);
  const childPrefix = `${prefix}${last ? "   " : "│  "}`;
  const promptOffset = stage.children.length;
  stage.prompts.forEach((prompt, promptIndex) =>
    lines.push(`${childPrefix}${promptIndex === stage.prompts.length - 1 && promptOffset === 0 ? "└─" : "├─"} ${promptLabel(prompt)}`),
  );
  stage.children.forEach((child, childIndex) =>
    pushStageLines(lines, child, childPrefix, childIndex === stage.children.length - 1, childIndex + 1, stage.children.length),
  );
}

function phaseLabel(outline: WorkflowOutline, phase: string): string {
  const metadata = outline.metadata.phases.find((candidate) => candidate.title === phase);
  return metadata?.detail ? `${phase} — ${metadata.detail}` : phase;
}

function stageLabel(stage: OutlineStage): string {
  const label = stage.label ? `: ${stage.label}` : "";
  const model = stage.model ? ` · model ${stage.model}` : "";
  const reasoning = stage.reasoning || MODEL_BEARING_KINDS.has(stage.kind) ? ` · think ${stage.reasoning ?? "default"}` : "";
  return `${stage.kind}${label}${model}${reasoning}`;
}

function promptLabel(prompt: OutlinePrompt): string {
  const template = prompt.templatePath ? ` ${prompt.templatePath}` : "";
  return `${prompt.role}: ${prompt.source}${template} · ${formatCharCount(prompt.charCount)}`;
}

function fileSummary(filePaths: readonly string[]): string {
  if (!filePaths.length) return "workflow.js";
  const visibleFiles = filePaths.slice(0, 5);
  const suffix = filePaths.length > visibleFiles.length ? ` +${String(filePaths.length - visibleFiles.length)} more` : "";
  return `${visibleFiles.join(", ")}${suffix}`;
}

function formatCharCount(count: number): string {
  if (count < 1000) return `${String(count)} chars`;
  if (count < 1_000_000) return `${trimFixed(count / 1000)}k chars`;
  return `${trimFixed(count / 1_000_000)}M chars`;
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
