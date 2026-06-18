import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../runtime.ts";

const DEFAULT_WIDTH = 96;
const MIN_WIDTH = 64;

type DisplayColor = "accent" | "borderMuted" | "dim" | "error" | "muted" | "success" | "text" | "warning";

export interface ProgressTheme {
  fg(color: DisplayColor, text: string): string;
  bold(text: string): string;
}

export interface ProgressDisplay {
  statusLine: string;
  widgetLines: string[];
  text: string;
}

interface NetStats {
  totalAgents: number;
  completedAgents: number;
  runningAgents: number;
  erroredAgents: number;
  inputTokenCount: number;
  outputTokenCount: number;
  toolCallCount: number;
}

interface PhaseSection {
  index: number;
  title: string;
  isCurrent: boolean;
  agents: WorkflowAgentSnapshot[];
  isExpanded: boolean;
}

const plainTheme: ProgressTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

export function initialProgressDisplay(
  workflowName = "workflow",
  width = DEFAULT_WIDTH,
  theme: ProgressTheme = plainTheme,
  input?: unknown,
): ProgressDisplay {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const statusLine = `${workflowName}: STARTING · 0/0 agents · in 0 · out 0 · tools 0 · Esc abort`;
  const inputLine = argsLine(input, safeWidth, theme);
  const widgetLines = [
    titleLine(`workflow ${workflowName}`, safeWidth, theme),
    ...(inputLine ? [inputLine] : []),
    theme.fg("warning", fit(`  STARTING · waiting for workflow runtime events · Esc abort`, safeWidth)),
    "",
    theme.fg("muted", fit(`  NET 0/0 agents · in 0 · out 0 · total 0 · tools 0`, safeWidth)),
  ];
  return { statusLine, widgetLines, text: widgetLines.join("\n") };
}

export function progressDisplay(snapshot: WorkflowSnapshot, width = DEFAULT_WIDTH, theme: ProgressTheme = plainTheme): ProgressDisplay {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const stats = netStats(snapshot);
  const state = workflowState(snapshot, stats);
  const statusLine = `${snapshot.workflowName}: ${state.label} · ${String(stats.completedAgents)}/${String(stats.totalAgents)} agents · in ${formatTokenCount(stats.inputTokenCount)} · out ${formatTokenCount(stats.outputTokenCount)} · tools ${String(stats.toolCallCount)}${state.kind === "running" ? " · Esc abort" : ""}`;
  const inputLine = argsLine(snapshot.input, safeWidth, theme);
  const widgetLines = [
    titleLine(`workflow ${snapshot.workflowName}`, safeWidth, theme),
    ...(inputLine ? [inputLine] : []),
    summaryLine(snapshot, stats, state, safeWidth, theme),
    "",
    ...phaseSections(snapshot).flatMap((section) => renderPhaseSection(section, safeWidth, theme)),
    "",
    netLine(snapshot, stats, safeWidth, theme),
  ];
  return { statusLine, widgetLines, text: widgetLines.join("\n") };
}

export function formatTokenCount(tokenCount: number): string {
  if (tokenCount === 1) return "1";
  if (tokenCount < 1000) return String(tokenCount);
  if (tokenCount < 1_000_000) return `${trimFixed(tokenCount / 1000)}k`;
  return `${trimFixed(tokenCount / 1_000_000)}M`;
}

function argsLine(input: unknown, width: number, theme: ProgressTheme): string | undefined {
  const rendered = compactJson(input);
  if (!rendered) return undefined;
  return fit(`  ${theme.fg("muted", "args")} ${theme.fg("text", rendered)}`, width);
}

function compactJson(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function titleLine(title: string, width: number, theme: ProgressTheme): string {
  const visibleTitle = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(visibleTitle) - 4);
  return fit(
    theme.fg("borderMuted", "──") + theme.fg("accent", theme.bold(visibleTitle)) + theme.fg("borderMuted", "─".repeat(fillLen)),
    width,
  );
}

function summaryLine(
  snapshot: WorkflowSnapshot,
  stats: NetStats,
  state: WorkflowDisplayState,
  width: number,
  theme: ProgressTheme,
): string {
  const phase = currentPhaseLabel(snapshot);
  const errors = stats.erroredAgents > 0 ? theme.fg("error", ` · ${String(stats.erroredAgents)} errors`) : "";
  const abortHint = state.kind === "running" ? theme.fg("warning", " · Esc abort") + theme.fg("muted", " · ⌥O inspect") : "";
  return fit(
    `  ${theme.fg(state.color, theme.bold(state.label))}` +
      ` ${theme.fg("muted", "·")} ${theme.fg("accent", phase)}` +
      ` ${theme.fg("muted", "· agents")} ${theme.fg("success", `${String(stats.completedAgents)}/${String(stats.totalAgents)}`)}` +
      ` ${theme.fg("muted", "· running")} ${theme.fg(stats.runningAgents > 0 ? "warning" : "dim", String(stats.runningAgents))}` +
      errors +
      abortHint,
    width,
  );
}

function renderPhaseSection(section: PhaseSection, width: number, theme: ProgressTheme): string[] {
  const glyph = phaseGlyph(section);
  const ident = section.index === 0 ? "setup" : `P${String(section.index)} ${section.title}`;
  const count =
    section.agents.length === 0
      ? "no agents yet"
      : `${String(section.agents.filter((agent) => agent.status !== "running").length)}/${String(section.agents.length)} agents`;
  const stats = phaseSummaryText(section);
  const runningElapsed = section.isExpanded ? "" : runningElapsedText(section.agents);
  const phaseLine = fit(
    `  ${theme.fg(glyph.color, glyph.glyph)} ${theme.fg(section.isCurrent ? "accent" : "text", theme.bold(ident))} ` +
      theme.fg("dim", `· ${count}${stats}${runningElapsed}`),
    width,
  );
  if (section.agents.length === 0 || !section.isExpanded) return [phaseLine];
  return [phaseLine, ...section.agents.flatMap((agent) => renderAgentRow(agent, width, theme))];
}

function renderAgentRow(agent: WorkflowAgentSnapshot, width: number, theme: ProgressTheme): string[] {
  const glyph = agentGlyph(agent);
  const labelWidth = Math.max(14, Math.min(30, width - 44));
  const identity = padVisible(fit(`#${String(agent.id)} ${agent.label}`, labelWidth), labelWidth);
  const meta = [
    agent.model ?? "default",
    agent.reasoning ?? "default",
    `${formatTokenCount(agent.inputTokenCount)}→${formatTokenCount(agent.outputTokenCount)}`,
    `${String(agent.toolCallCount)} ${agent.toolCallCount === 1 ? "tool" : "tools"}`,
  ];
  if (agent.status === "running" && agent.startedAt > 0) meta.push(formatDuration(Date.now() - agent.startedAt));
  const lines = [
    fit(`     ${theme.fg(glyph.color, glyph.glyph)} ${theme.fg("text", identity)} ${theme.fg("dim", meta.join(" · "))}`, width),
  ];
  const note = agent.error ?? (agent.status === "running" ? agent.message : undefined);
  if (note?.trim()) lines.push(fit(`        ${theme.fg(agent.error ? "error" : "muted", `↳ ${note.trim()}`)}`, width));
  return lines;
}

function netLine(snapshot: WorkflowSnapshot, stats: NetStats, width: number, theme: ProgressTheme): string {
  const totalTokenCount = stats.inputTokenCount + stats.outputTokenCount;
  return fit(
    `  ${theme.fg("muted", "NET")} ` +
      `${theme.fg("success", `${String(stats.completedAgents)}/${String(stats.totalAgents)} agents`)} · ` +
      `${theme.fg("accent", `${formatTokenCount(stats.inputTokenCount)} in`)} · ` +
      `${theme.fg("warning", `${formatTokenCount(stats.outputTokenCount)} out`)} · ` +
      `${theme.fg("muted", `${formatTokenCount(totalTokenCount)} total`)} · ` +
      `${theme.fg("success", `${String(stats.toolCallCount)} tools`)} · ` +
      theme.fg("muted", `${String(snapshot.fanOuts.length)} ${snapshot.fanOuts.length === 1 ? "fanout" : "fanouts"}`),
    width,
  );
}

function netStats(snapshot: WorkflowSnapshot): NetStats {
  const completedAgents = snapshot.agents.filter((agent) => agent.status !== "running").length;
  return {
    totalAgents: snapshot.agents.length,
    completedAgents,
    runningAgents: snapshot.agents.length - completedAgents,
    erroredAgents: snapshot.agents.filter((agent) => agent.status === "error").length,
    inputTokenCount: snapshot.agents.reduce((total, agent) => total + agent.inputTokenCount, 0),
    outputTokenCount: snapshot.agents.reduce((total, agent) => total + agent.outputTokenCount, 0),
    toolCallCount: snapshot.agents.reduce((total, agent) => total + agent.toolCallCount, 0),
  };
}

function phaseSections(snapshot: WorkflowSnapshot): PhaseSection[] {
  const explicitSections = snapshot.phases.map((title, index) => phaseSection(snapshot, index + 1, title));
  const startupAgents = snapshot.agents.filter((agent) => agent.phaseIndex === 0);
  if (startupAgents.length === 0 && explicitSections.length > 0) return explicitSections;
  return [phaseSection(snapshot, 0, "startup"), ...explicitSections];
}

function phaseSection(snapshot: WorkflowSnapshot, index: number, title: string): PhaseSection {
  const currentIndex = snapshot.phases.length;
  const agents = snapshot.agents.filter((agent) => agent.phaseIndex === index);
  const section = { index, title, isCurrent: index === currentIndex, agents, isExpanded: false };
  return { ...section, isExpanded: phaseShouldExpand(section, snapshot) };
}

function phaseShouldExpand(section: PhaseSection, snapshot: WorkflowSnapshot): boolean {
  const phaseAgents = section.agents;
  if (phaseAgents.some((agent) => agent.status === "running")) return true;
  return section.isCurrent && snapshot.result === undefined;
}

function phaseSummaryText(section: PhaseSection): string {
  if (section.agents.length === 0) return "";
  const inputTokenCount = section.agents.reduce((total, agent) => total + agent.inputTokenCount, 0);
  const outputTokenCount = section.agents.reduce((total, agent) => total + agent.outputTokenCount, 0);
  const toolCallCount = section.agents.reduce((total, agent) => total + agent.toolCallCount, 0);
  const elapsed = !section.isExpanded ? phaseElapsedMs(section.agents) : undefined;
  const elapsedText = elapsed !== undefined ? ` · ${formatDuration(elapsed)}` : "";
  return ` · ${formatTokenCount(inputTokenCount)}→${formatTokenCount(outputTokenCount)} · ${String(toolCallCount)} tools${elapsedText}`;
}

function phaseElapsedMs(agents: WorkflowAgentSnapshot[]): number | undefined {
  if (!agents.length || agents.some((agent) => agent.endedAt === undefined)) return undefined;
  const startedAt = Math.min(...agents.map((agent) => agent.startedAt));
  const endedAt = Math.max(...agents.map((agent) => agent.endedAt ?? agent.startedAt));
  return Math.max(0, endedAt - startedAt);
}

function runningElapsedText(agents: WorkflowAgentSnapshot[]): string {
  const runningAgents = agents.filter((agent) => agent.status === "running" && agent.startedAt > 0);
  if (!runningAgents.length) return "";
  const startedAt = Math.min(...runningAgents.map((agent) => agent.startedAt));
  return ` · running ${formatDuration(Date.now() - startedAt)}`;
}

export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 1000) return `${String(safeMs)}ms`;
  const seconds = safeMs / 1000;
  if (seconds < 60) return `${trimFixed(seconds)}s`;
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  return `${String(minutes)}m ${String(wholeSeconds % 60).padStart(2, "0")}s`;
}

interface WorkflowDisplayState {
  kind: "running" | "complete" | "error";
  label: string;
  color: DisplayColor;
}

function workflowState(snapshot: WorkflowSnapshot, stats: NetStats): WorkflowDisplayState {
  if (stats.erroredAgents > 0) return { kind: "error", label: "ERROR", color: "error" };
  if (snapshot.result !== undefined) return { kind: "complete", label: "DONE", color: "success" };
  return { kind: "running", label: "RUNNING", color: "warning" };
}

function phaseGlyph(section: PhaseSection): { glyph: string; color: DisplayColor } {
  if (section.agents.some((agent) => agent.status === "error")) return { glyph: "✗", color: "error" };
  if (section.agents.some((agent) => agent.status === "running")) return { glyph: "▸", color: "warning" };
  if (section.agents.length > 0) return { glyph: "✓", color: "success" };
  if (section.isCurrent) return { glyph: "…", color: "accent" };
  return { glyph: "·", color: "dim" };
}

function currentPhaseLabel(snapshot: WorkflowSnapshot): string {
  const index = snapshot.phases.length;
  if (index === 0) return "setup";
  return `P${String(index)}/${String(snapshot.phases.length)} ${snapshot.phases[index - 1]}`;
}

function agentGlyph(agent: WorkflowAgentSnapshot): { glyph: string; color: DisplayColor } {
  if (agent.status === "done") return { glyph: "✓", color: "success" };
  if (agent.status === "error") return { glyph: "✗", color: "error" };
  return { glyph: "▸", color: "warning" };
}

function padVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function fit(text: string, width: number): string {
  if (!text.includes("\u001B")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`;
  return truncateToWidth(text, width, "...");
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
