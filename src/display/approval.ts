import type { GeneratedWorkflowDraft } from "../request.ts";
import { parseWorkflowOutline } from "../workflow-outline.ts";
import { workflowFlowchartLines } from "./workflow-flowchart.ts";

const CONTENT_WIDTH = 84;

export interface ApprovalDisplayOptions {
  feedbackMode?: boolean;
  feedback?: string;
}

export function approvalLines(draft: GeneratedWorkflowDraft, options: ApprovalDisplayOptions = {}): string[] {
  const parsedOutline = parseWorkflowOutline(draft.source, { ...(draft.sourceDirectory ? { workflowDir: draft.sourceDirectory } : {}) });
  const outline = { ...parsedOutline, metadata: draft.metadata };
  return [
    border("╭", `Review generated workflow: ${draft.name}`, "╮"),
    ...wrappedRows(`Description: ${draft.metadata.description}`),
    border("├", "Flowchart", "┤"),
    ...workflowFlowchartLines(outline, { filePaths: draft.filePaths, maxLines: 24 }).map((line) => row(line, 2)),
    border("├", "After Approval", "┤"),
    ...draft.proposal.willRun.flatMap((step) => wrappedListRows("-", step)),
    border("├", options.feedbackMode ? "Feedback" : "Decision", "┤"),
    ...(options.feedbackMode ? feedbackRows(options.feedback ?? "") : decisionRows()),
    border("╰", "", "╯"),
  ];
}

function decisionRows(): string[] {
  return [row("Approve only if the plan and source match your intent."), row("y approve · n reject · Tab give feedback · Esc reject")];
}

function feedbackRows(feedback: string): string[] {
  const content = feedback.trim() ? feedback : "Type feedback for the agent, then press Enter. Esc returns to review.";
  return [row("Feedback will be sent to the agent instead of saving this workflow."), ...wrappedRows(`> ${content}`, 2)];
}

function wrappedListRows(prefix: string, content: string): string[] {
  const firstIndent = 2;
  const continuationIndent = firstIndent + prefix.length + 1;
  const lines = wrapWords(`${prefix} ${content}`, CONTENT_WIDTH - firstIndent);
  return lines.map((line, index) => row(line, index === 0 ? firstIndent : continuationIndent));
}

function wrappedRows(content: string, indent = 0): string[] {
  return wrapWords(content, CONTENT_WIDTH - indent).map((line) => row(line, indent));
}

function row(content: string, indent = 0): string {
  const visibleContent = `${" ".repeat(indent)}${content}`;
  const paddedContent = visibleContent.length > CONTENT_WIDTH ? `${visibleContent.slice(0, CONTENT_WIDTH - 3)}...` : visibleContent;
  return `│ ${paddedContent.padEnd(CONTENT_WIDTH, " ")} │`;
}

function border(left: string, title: string, right: string): string {
  if (!title) return `${left}${"─".repeat(CONTENT_WIDTH + 2)}${right}`;
  const label = ` ${title.slice(0, CONTENT_WIDTH - 4)} `;
  return `${left}─${label}${"─".repeat(Math.max(0, CONTENT_WIDTH + 1 - label.length))}${right}`;
}

function wrapWords(content: string, width: number): string[] {
  if (!content) return [""];
  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.flatMap((wrappedLine) => hardWrap(wrappedLine, width));
}

function hardWrap(content: string, width: number): string[] {
  if (content.length <= width) return [content];
  const lines: string[] = [];
  for (let index = 0; index < content.length; index += width) lines.push(content.slice(index, index + width));
  return lines;
}
