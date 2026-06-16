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
): ProgressDisplay {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const statusLine = `${workflowName}: STARTING · 0/0 agents · in 0 · out 0 · tools 0 · Esc abort`;
  const widgetLines = [
    titleLine(`workflow ${workflowName}`, safeWidth, theme),
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
  const widgetLines = [
    titleLine(`workflow ${snapshot.workflowName}`, safeWidth, theme),
    summaryLine(snapshot, stats, state, safeWidth, theme),
    "",
    tableHeader(safeWidth, theme),
    theme.fg("borderMuted", fit(`  ${"-".repeat(Math.max(0, safeWidth - 4))}`, safeWidth)),
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

function titleLine(title: string, width: number, theme: ProgressTheme): string {
  const visibleTitle = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(visibleTitle) - 3);
  return fit(
    theme.fg("borderMuted", "--") + theme.fg("accent", theme.bold(visibleTitle)) + theme.fg("borderMuted", "-".repeat(fillLen)),
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
  const abortHint = state.kind === "running" ? theme.fg("warning", " · Esc abort") : "";
  return fit(
    `  ${theme.fg(state.color, state.label)} ` +
      `${theme.fg("muted", "· phase")} ${theme.fg("accent", phase)} ` +
      `${theme.fg("muted", "· agents")} ${theme.fg("success", `${String(stats.completedAgents)}/${String(stats.totalAgents)}`)} ` +
      `${theme.fg("muted", "· running")} ${theme.fg(stats.runningAgents > 0 ? "warning" : "dim", String(stats.runningAgents))}` +
      errors +
      abortHint,
    width,
  );
}

function tableHeader(width: number, theme: ProgressTheme): string {
  const columns = agentColumns(width);
  return fit(
    `  ${theme.fg("muted", padVisible("phase/agent", columns.label))}` +
      theme.fg("muted", padVisible("status", columns.status)) +
      theme.fg("muted", padVisible("model", columns.model)) +
      theme.fg("muted", padVisible("thinking", columns.reasoning)) +
      theme.fg("muted", padVisible("tokens", columns.tokens)) +
      theme.fg("muted", "tools / message"),
    width,
  );
}

function renderPhaseSection(section: PhaseSection, width: number, theme: ProgressTheme): string[] {
  const phaseStatus = phaseStatusText(section);
  const phaseStats = phaseSummaryText(section);
  const phaseLabel = section.index === 0 ? "setup" : `P${String(section.index)}`;
  const phaseTitle = section.index === 0 ? "" : `${section.title} `;
  const phaseCount =
    section.agents.length === 0
      ? "no agents yet"
      : `${String(section.agents.filter((agent) => agent.status !== "running").length)}/${String(section.agents.length)} agents`;
  const runningElapsed = section.isExpanded ? "" : runningElapsedText(section.agents);
  const phaseLine = fit(
    `  ${theme.fg(phaseStatus.color, phaseStatus.label)} ${theme.fg("muted", `${phaseLabel} `)}` +
      theme.fg(section.isCurrent ? "accent" : "text", phaseTitle) +
      theme.fg("dim", `${phaseCount}${phaseStats}${runningElapsed}`),
    width,
  );
  if (section.agents.length === 0 || !section.isExpanded) return [phaseLine];
  return [phaseLine, ...section.agents.map((agent) => renderAgentRow(agent, width, theme))];
}

function renderAgentRow(agent: WorkflowAgentSnapshot, width: number, theme: ProgressTheme): string {
  const columns = agentColumns(width);
  const status = agentStatusText(agent);
  const label = fitCell(`    #${String(agent.id)} ${agent.label}`, columns.label);
  const model = fitCell(agent.model ?? "default", columns.model);
  const reasoning = fitCell(agent.reasoning ?? "default", columns.reasoning);
  const tokens = fitCell(`${formatTokenCount(agent.inputTokenCount)} in / ${formatTokenCount(agent.outputTokenCount)} out`, columns.tokens);
  const elapsed = agent.status === "running" && agent.startedAt > 0 ? `${formatDuration(Date.now() - agent.startedAt)} ` : "";
  const message = agent.error ?? `${elapsed}${agent.message ?? ""}`;
  return fit(
    `  ${theme.fg("text", label)}` +
      theme.fg(status.color, fitCell(status.label, columns.status)) +
      theme.fg("accent", model) +
      theme.fg("warning", reasoning) +
      theme.fg("muted", tokens) +
      theme.fg("success", `${String(agent.toolCallCount).padStart(2)} tools `) +
      theme.fg(agent.error ? "error" : "dim", message),
    width,
  );
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
      theme.fg("muted", `${String(snapshot.fanOuts.length)} fanouts`),
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
  return ` · ${formatTokenCount(inputTokenCount)} in / ${formatTokenCount(outputTokenCount)} out · ${String(toolCallCount)} tools${elapsedText}`;
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

function formatDuration(ms: number): string {
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

function phaseStatusText(section: PhaseSection): { label: string; color: DisplayColor } {
  if (section.agents.some((agent) => agent.status === "error")) return { label: "ERR", color: "error" };
  if (section.agents.some((agent) => agent.status === "running")) return { label: "RUN", color: "warning" };
  if (section.agents.length > 0) return { label: "OK ", color: "success" };
  if (section.isCurrent) return { label: "...", color: "accent" };
  return { label: "---", color: "dim" };
}

function currentPhaseLabel(snapshot: WorkflowSnapshot): string {
  const index = snapshot.phases.length;
  if (index === 0) return "setup";
  return `P${String(index)}/${String(snapshot.phases.length)} ${snapshot.phases[index - 1]}`;
}

function agentStatusText(agent: WorkflowAgentSnapshot): { label: string; color: DisplayColor } {
  if (agent.status === "done") return { label: "done", color: "success" };
  if (agent.status === "error") return { label: "err ", color: "error" };
  return { label: "run ", color: "warning" };
}

function agentColumns(width: number): { label: number; status: number; model: number; reasoning: number; tokens: number } {
  const status = 7;
  const model = width < 88 ? 12 : 18;
  const reasoning = 10;
  const tokens = 20;
  const toolsAndMessage = 27;
  return {
    label: Math.max(18, Math.min(40, width - 2 - status - model - reasoning - tokens - toolsAndMessage)),
    status,
    model,
    reasoning,
    tokens,
  };
}

function fitCell(text: string, width: number): string {
  return padVisible(fit(text, Math.max(1, width - 1)), width);
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
