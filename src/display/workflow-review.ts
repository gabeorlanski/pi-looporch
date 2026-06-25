import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  indexOutlinePrompts,
  indexOutlineStages,
  type OutlinePrompt,
  type OutlineSection,
  type OutlineStage,
  type WorkflowOutline,
} from "../workflow-outline.ts";
import type { ProgressTheme } from "./progress.ts";

const MIN_WIDTH = 56;
const EXCERPT_LENGTH = 72;

const plainTheme: ProgressTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

export type ReviewNodeKind = "section" | "stage" | "prompt";

export interface ReviewNode {
  id: string;
  kind: ReviewNodeKind;
  depth: number;
  label: string;
  expandable: boolean;
  /** Comment target key, present for stage and prompt nodes. */
  commentKey?: string;
  stageId?: string;
  promptId?: string;
  section?: OutlineSection;
  stage?: OutlineStage;
  prompt?: OutlinePrompt;
}

export interface ReviewComment {
  stageId: string;
  promptId?: string;
  text: string;
}

export interface ReviewViewState {
  selectedIndex: number;
  expanded: ReadonlySet<string>;
  comments: ReadonlyMap<string, ReviewComment>;
  generalComment: string;
  editing?: { kind: "node" | "general"; text: string };
  height: number;
  hint?: string;
}

export function defaultExpanded(outline: WorkflowOutline): Set<string> {
  const expanded = new Set<string>();
  for (const section of outline.sections) {
    expanded.add(section.id);
    const walk = (stage: OutlineStage): void => {
      expanded.add(stage.id);
      stage.children.forEach(walk);
    };
    section.stages.forEach(walk);
  }
  return expanded;
}

export function flattenReviewNodes(outline: WorkflowOutline, expanded: ReadonlySet<string>): ReviewNode[] {
  const nodes: ReviewNode[] = [];
  outline.sections.forEach((section, index) => {
    nodes.push({
      id: section.id,
      kind: "section",
      depth: 0,
      label: sectionLabel(section, index),
      expandable: section.stages.length > 0,
      section,
    });
    if (!expanded.has(section.id)) return;
    for (const stage of section.stages) pushStageNodes(nodes, stage, 1, expanded);
  });
  return nodes;
}

function pushStageNodes(nodes: ReviewNode[], stage: OutlineStage, depth: number, expanded: ReadonlySet<string>): void {
  const hasChildren = stage.prompts.length > 0 || stage.children.length > 0;
  nodes.push({
    id: stage.id,
    kind: "stage",
    depth,
    label: stage.label ?? stage.kind,
    expandable: hasChildren,
    commentKey: stage.id,
    stageId: stage.id,
    stage,
  });
  if (!expanded.has(stage.id)) return;
  for (const prompt of stage.prompts) {
    nodes.push({
      id: prompt.id,
      kind: "prompt",
      depth: depth + 1,
      label: prompt.role,
      expandable: true,
      commentKey: promptCommentKey(stage.id, prompt.id),
      stageId: stage.id,
      promptId: prompt.id,
      prompt,
    });
  }
  for (const child of stage.children) pushStageNodes(nodes, child, depth + 1, expanded);
}

export function promptCommentKey(stageId: string, promptId: string): string {
  return `${stageId}::${promptId}`;
}

export function reviewHasFeedback(comments: ReadonlyMap<string, ReviewComment>, generalComment: string): boolean {
  if (generalComment.trim()) return true;
  for (const comment of comments.values()) if (comment.text.trim()) return true;
  return false;
}

export function buildChangeRequest(outline: WorkflowOutline, comments: ReadonlyMap<string, ReviewComment>, generalComment: string): string {
  const stages = indexOutlineStages(outline);
  const prompts = indexOutlinePrompts(outline);
  const lines = ["The reviewer requested changes to this generated workflow."];
  const general = generalComment.trim();
  if (general) lines.push("", general);
  const targeted = [...comments.values()].filter((comment) => comment.text.trim());
  if (targeted.length) {
    lines.push("", "Targeted notes:");
    for (const comment of targeted) {
      const context = stages.get(comment.stageId);
      const stageLabel = context ? (context.stage.label ?? context.stage.kind) : comment.stageId;
      const phase = context?.phase ? ` · phase '${context.phase}'` : "";
      const prompt = comment.promptId ? prompts.get(comment.promptId) : undefined;
      const excerpt = prompt ? ` · prompt "${collapseText(prompt.text, 80)}"` : "";
      lines.push(`- [${stageLabel}${phase}${excerpt}] ${comment.text.trim()}`);
    }
  }
  return lines.join("\n");
}

export function renderWorkflowReview(
  outline: WorkflowOutline,
  state: ReviewViewState,
  width = 96,
  theme: ProgressTheme = plainTheme,
): string[] {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const nodes = flattenReviewNodes(outline, state.expanded);
  const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, nodes.length - 1));
  const header = headerLines(outline, safeWidth, theme);
  const tail = tailLines(nodes, selectedIndex, state, safeWidth, theme);
  const viewport = Math.max(4, state.height - header.length - tail.length);
  const tree = treeRegion(nodes, selectedIndex, state, viewport, safeWidth, theme);
  return [...header, ...tree, ...tail];
}

function headerLines(outline: WorkflowOutline, width: number, theme: ProgressTheme): string[] {
  const counts = outlineCounts(outline);
  const name = outline.metadata.name || "workflow";
  const lines = [
    titleLine(`review workflow ${name}`, width, theme),
    fit(`  ${theme.fg("muted", outline.metadata.description || "(no description)")}`, width),
    fit(
      `  ${theme.fg("dim", `${plural(counts.phases, "phase")} · ${plural(counts.stages, "stage")} · ${plural(counts.agents, "agent call")}`)}`,
      width,
    ),
  ];
  for (const warning of outline.warnings) lines.push(fit(`  ${theme.fg("warning", `⚠ ${warning}`)}`, width));
  lines.push("");
  return lines;
}

function tailLines(nodes: ReviewNode[], selectedIndex: number, state: ReviewViewState, width: number, theme: ProgressTheme): string[] {
  const lines = [""];
  if (state.editing) {
    lines.push(...editorBox(nodes[selectedIndex], state.editing, width, theme));
  } else {
    const noteCount = [...state.comments.values()].filter((comment) => comment.text.trim()).length;
    const general = state.generalComment.trim();
    lines.push(
      fit(
        `  ${theme.fg("muted", "general:")} ${general ? theme.fg("text", collapseText(general, width - 24)) : theme.fg("dim", "(none — press g)")}` +
          ` ${theme.fg("dim", "·")} ${theme.fg(noteCount ? "warning" : "dim", `${String(noteCount)} note${noteCount === 1 ? "" : "s"}`)}`,
        width,
      ),
    );
  }
  if (state.hint) lines.push(fit(`  ${theme.fg("warning", state.hint)}`, width));
  lines.push(footerLine(Boolean(state.editing), theme, width));
  return lines;
}

function editorBox(
  node: ReviewNode | undefined,
  editing: { kind: "node" | "general"; text: string },
  width: number,
  theme: ProgressTheme,
): string[] {
  const target = editing.kind === "general" ? "general comment" : `note on ${node ? nodeTargetLabel(node) : "selection"}`;
  const body = editing.text.length ? editing.text : "";
  return [
    fit(`  ${theme.fg("accent", theme.bold(`✎ ${target}`))}`, width),
    fit(`  ${theme.fg("borderMuted", "│")} ${theme.fg("text", body)}${theme.fg("accent", "▏")}`, width),
  ];
}

function footerLine(editing: boolean, theme: ProgressTheme, width: number): string {
  const keys = editing
    ? "enter save · esc cancel"
    : "↑↓ move · Ctrl+O expand · c note · g general · a approve · r request changes · t text · esc";
  return fit(`  ${theme.fg("dim", keys)}`, width);
}

function treeRegion(
  nodes: ReviewNode[],
  selectedIndex: number,
  state: ReviewViewState,
  viewport: number,
  width: number,
  theme: ProgressTheme,
): string[] {
  if (nodes.length === 0) return [theme.fg("dim", "  (no stages found in this workflow)")];
  const blocks = nodes.map((node, index) => nodeBlock(node, index === selectedIndex, state, width, theme));
  const flat: { text: string; node: number }[] = [];
  blocks.forEach((block, index) => block.forEach((text) => flat.push({ text, node: index })));
  if (flat.length <= viewport) return flat.map((line) => line.text);
  const firstLine = flat.findIndex((line) => line.node === selectedIndex);
  const lastLine = flat.length - 1 - [...flat].reverse().findIndex((line) => line.node === selectedIndex);
  let start = clamp(firstLine, 0, Math.max(0, flat.length - viewport));
  if (lastLine >= start + viewport) start = clamp(lastLine - viewport + 1, 0, Math.max(0, flat.length - viewport));
  if (firstLine < start) start = firstLine;
  const visible = flat.slice(start, start + viewport).map((line) => line.text);
  const more = flat.length - viewport;
  if (more > 0)
    visible[visible.length - 1] = fit(`  ${theme.fg("dim", `… ${String(more)} more line${more === 1 ? "" : "s"} (↑↓ to scroll)`)}`, width);
  return visible;
}

function nodeBlock(node: ReviewNode, selected: boolean, state: ReviewViewState, width: number, theme: ProgressTheme): string[] {
  if (node.kind === "section") return [sectionLine(node, selected, state.expanded, width, theme)];
  if (node.kind === "stage")
    return [stageLine(node, selected, state.expanded, state.comments, width, theme), ...commentLines(node, state.comments, width, theme)];
  return [
    ...promptLines(node, selected, state.expanded, state.comments, width, theme),
    ...commentLines(node, state.comments, width, theme),
  ];
}

function sectionLine(node: ReviewNode, selected: boolean, expanded: ReadonlySet<string>, width: number, theme: ProgressTheme): string {
  const caret = node.expandable ? (expanded.has(node.id) ? "▾" : "▸") : "·";
  return fit(
    `${marker(selected, theme)}${indent(node.depth)}${theme.fg("accent", caret)} ${theme.fg("accent", theme.bold(node.label))}`,
    width,
  );
}

function stageLine(
  node: ReviewNode,
  selected: boolean,
  expanded: ReadonlySet<string>,
  comments: ReadonlyMap<string, ReviewComment>,
  width: number,
  theme: ProgressTheme,
): string {
  const stage = node.stage;
  if (!stage) return "";
  const caret = node.expandable ? (expanded.has(node.id) ? "▾" : "▸") : "·";
  const badge = theme.fg("accent", stage.kind.toUpperCase());
  const meta = stageMeta(stage, theme);
  const note = commentMarker(node, comments, theme);
  const label = selected ? theme.fg("text", theme.bold(node.label)) : theme.fg("text", node.label);
  return fit(`${marker(selected, theme)}${indent(node.depth)}${theme.fg("dim", caret)} ${badge} ${label}${meta}${note}`, width);
}

const MODEL_BEARING_KINDS = new Set(["agent", "coerce", "mapreduce", "verifier"]);

function stageMeta(stage: OutlineStage, theme: ProgressTheme): string {
  const parts: string[] = [];
  if (stage.model) parts.push(theme.fg("muted", stage.model));
  // Thinking level only applies to stages that issue model calls.
  if (stage.reasoning || MODEL_BEARING_KINDS.has(stage.kind)) {
    parts.push(theme.fg(stage.reasoning ? "warning" : "dim", `think ${stage.reasoning ?? "default"}`));
  }
  if (stage.prompts.length) {
    const promptChars = stage.prompts.reduce((total, prompt) => total + prompt.charCount, 0);
    const hasLargePrompt = stage.prompts.some((prompt) => prompt.sizeWarning !== undefined);
    parts.push(theme.fg(hasLargePrompt ? "warning" : "dim", `${plural(stage.prompts.length, "prompt")} · ${formatCharCount(promptChars)}`));
  }
  if (stage.children.length) parts.push(theme.fg("dim", plural(stage.children.length, "child", "children")));
  return parts.length ? ` ${theme.fg("dim", "·")} ${parts.join(theme.fg("dim", " · "))}` : "";
}

function promptLines(
  node: ReviewNode,
  selected: boolean,
  expanded: ReadonlySet<string>,
  comments: ReadonlyMap<string, ReviewComment>,
  width: number,
  theme: ProgressTheme,
): string[] {
  const prompt = node.prompt;
  if (!prompt) return [];
  const open = expanded.has(node.id);
  const caret = open ? "▾" : "▸";
  const tags = `${theme.fg("muted", prompt.role)} ${theme.fg("dim", `[${prompt.source}${prompt.editable ? "" : " · read-only"}]`)} ${promptSizeMeta(prompt, theme)}`;
  const note = commentMarker(node, comments, theme);
  if (!open) {
    const excerpt = theme.fg("dim", `"${collapseText(prompt.text, EXCERPT_LENGTH)}"`);
    return [fit(`${marker(selected, theme)}${indent(node.depth)}${theme.fg("dim", caret)} ${tags} ${excerpt}${note}`, width)];
  }
  const head = fit(`${marker(selected, theme)}${indent(node.depth)}${theme.fg("dim", caret)} ${tags}${note}`, width);
  const textIndent = indent(node.depth + 1);
  const bodyWidth = width - visibleWidth(textIndent) - 4;
  const body = wrap(prompt.text, Math.max(20, bodyWidth)).map((line) => fit(`  ${textIndent}${theme.fg("text", line)}`, width));
  if (prompt.templatePath) body.push(fit(`  ${textIndent}${theme.fg("dim", `template: ${prompt.templatePath}`)}`, width));
  return [head, ...body];
}

function promptSizeMeta(prompt: OutlinePrompt, theme: ProgressTheme): string {
  const text = prompt.sizeWarning ? `⚠ ${formatCharCount(prompt.charCount)}` : formatCharCount(prompt.charCount);
  return theme.fg(prompt.sizeWarning ? "warning" : "dim", `· ${text}`);
}

function formatCharCount(count: number): string {
  if (count < 1000) return `${String(count)} chars`;
  if (count < 1_000_000) return `${trimFixed(count / 1000)}k chars`;
  return `${trimFixed(count / 1_000_000)}M chars`;
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function commentLines(node: ReviewNode, comments: ReadonlyMap<string, ReviewComment>, width: number, theme: ProgressTheme): string[] {
  if (!node.commentKey) return [];
  const comment = comments.get(node.commentKey);
  if (!comment?.text.trim()) return [];
  return wrap(comment.text.trim(), Math.max(20, width - visibleWidth(indent(node.depth + 1)) - 8)).map((line, index) =>
    fit(`  ${indent(node.depth)}${theme.fg("warning", index === 0 ? "↳ note: " : "         ")}${theme.fg("muted", line)}`, width),
  );
}

function commentMarker(node: ReviewNode, comments: ReadonlyMap<string, ReviewComment>, theme: ProgressTheme): string {
  if (node.commentKey && comments.get(node.commentKey)?.text.trim()) return ` ${theme.fg("warning", "✎")}`;
  return "";
}

function nodeTargetLabel(node: ReviewNode): string {
  if (node.kind === "prompt") return `${node.label} prompt`;
  return node.label;
}

function marker(selected: boolean, theme: ProgressTheme): string {
  return selected ? theme.fg("accent", "› ") : "  ";
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function outlineCounts(outline: WorkflowOutline): { phases: number; stages: number; agents: number } {
  let stages = 0;
  let agents = 0;
  const walk = (stage: OutlineStage): void => {
    stages += 1;
    if (stage.kind === "agent") agents += 1;
    stage.children.forEach(walk);
  };
  for (const section of outline.sections) section.stages.forEach(walk);
  return { phases: outline.sections.filter((section) => section.phase !== undefined).length, stages, agents };
}

function sectionLabel(section: OutlineSection, index: number): string {
  if (section.phase !== undefined) return `Phase: ${section.phase}`;
  return index === 0 ? "Setup" : "Section";
}

function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function collapseText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (max <= 1) return collapsed;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/(\s+)/).filter((part) => part.length > 0);
    let line = "";
    for (const word of words) {
      if (visibleWidth(line + word) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = word.trimStart();
      while (visibleWidth(line) > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}

function titleLine(title: string, width: number, theme: ProgressTheme): string {
  const label = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(label) - 4);
  return fit(theme.fg("borderMuted", "──") + theme.fg("accent", theme.bold(label)) + theme.fg("borderMuted", "─".repeat(fillLen)), width);
}

function fit(text: string, width: number): string {
  if (!text.includes("")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
  return truncateToWidth(text, width, "…");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
