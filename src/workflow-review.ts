import type { GeneratedWorkflowDraft } from "./workflow-request.ts";

const CONTENT_WIDTH = 47;

export function workflowApprovalLines(draft: GeneratedWorkflowDraft): string[] {
  return [
    "╭─ Workflow approval ─────────────────────────────╮",
    row(draft.name),
    row(draft.metadata.description),
    "├─ Review checklist ──────────────────────────────┤",
    row("Goal"),
    row(`  ${draft.proposal.summary}`),
    row("Steps"),
    ...draft.proposal.steps.map((step, index) => row(`  ${index + 1}. ${step}`)),
    row("What will run"),
    ...draft.proposal.willRun.map((step) => row(`  • ${step}`)),
    "├─ Decision ──────────────────────────────────────┤",
    row("Approve only if this matches your intent."),
    row("y approve · n reject · Esc reject"),
    "╰─────────────────────────────────────────────────╯",
  ];
}

function row(content: string): string {
  return `│ ${content.padEnd(CONTENT_WIDTH, " ")} │`;
}
