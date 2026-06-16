import type { GeneratedWorkflowDraft } from "./workflow-request.ts";

const CONTENT_WIDTH = 76;

export function workflowApprovalLines(draft: GeneratedWorkflowDraft): string[] {
  return [
    border("╭", "Workflow approval", "╮"),
    ...wrappedRows(draft.name),
    ...wrappedRows(draft.metadata.description),
    border("├", "Review", "┤"),
    row("Goal"),
    ...wrappedRows(draft.proposal.summary, 2),
    row(""),
    row("Steps"),
    ...draft.proposal.steps.flatMap((step, index) => wrappedListRows(`${String(index + 1)}.`, step)),
    row(""),
    row("What will run"),
    ...draft.proposal.willRun.flatMap((step) => wrappedListRows("•", step)),
    border("├", "Decision", "┤"),
    row("Approve only if this matches your intent."),
    row("y approve · n reject · Esc reject"),
    border("╰", "", "╯"),
  ];
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
  const paddedContent = `${" ".repeat(indent)}${content}`.padEnd(CONTENT_WIDTH, " ");
  return `│ ${paddedContent} │`;
}

function border(left: string, title: string, right: string): string {
  if (!title) return `${left}${"─".repeat(CONTENT_WIDTH + 2)}${right}`;
  const label = ` ${title} `;
  return `${left}─${label}${"─".repeat(CONTENT_WIDTH + 1 - label.length)}${right}`;
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
