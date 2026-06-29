import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../runtime-types.ts";
import { fit, titleLine, trimFixed } from "./text.ts";

const DEFAULT_WIDTH = 96;
const MIN_WIDTH = 64;
const MAX_VISIBLE_AGENTS = 6;

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
  const widgetLines = [
    titleLine(`workflow ${workflowName}`, safeWidth, theme),
    ...optionalInputLine(input, safeWidth, theme),
    theme.fg("warning", fit("  STARTING · waiting for workflow runtime update", safeWidth)),
    theme.fg("muted", fit("  NET 0/0 agents · in 0 · out 0 · total 0 · tools 0", safeWidth)),
  ];
  return { statusLine: `${workflowName}: STARTING · 0/0 agents · in 0 · out 0 · tools 0`, widgetLines, text: widgetLines.join("\n") };
}

export function progressDisplay(snapshot: WorkflowSnapshot, width = DEFAULT_WIDTH, theme: ProgressTheme = plainTheme): ProgressDisplay {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const stats = netStats(snapshot);
  const state = workflowState(snapshot, stats);
  const statusLine = `${snapshot.workflowName}: ${state.label} · ${String(stats.completedAgents)}/${String(stats.totalAgents)} agents · in ${formatTokenCount(stats.inputTokenCount)} · out ${formatTokenCount(stats.outputTokenCount)} · tools ${String(stats.toolCallCount)}`;
  const widgetLines = [
    titleLine(`workflow ${snapshot.workflowName}`, safeWidth, theme),
    ...optionalInputLine(snapshot.input, safeWidth, theme),
    summaryLine(snapshot, stats, state, safeWidth, theme),
    ...phaseLine(snapshot, safeWidth, theme),
    ...agentLines(snapshot.agents, safeWidth, theme),
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

function optionalInputLine(input: unknown, width: number, theme: ProgressTheme): string[] {
  const rendered = JSON.stringify(input);
  return rendered ? [fit(`  ${theme.fg("muted", "input")} ${theme.fg("text", rendered)}`, width)] : [];
}

function summaryLine(
  snapshot: WorkflowSnapshot,
  stats: NetStats,
  state: WorkflowDisplayState,
  width: number,
  theme: ProgressTheme,
): string {
  const errors = stats.erroredAgents > 0 ? ` · ${String(stats.erroredAgents)} errors` : "";
  return fit(
    `  ${theme.fg(state.color, theme.bold(state.label))} · ${theme.fg("accent", currentPhase(snapshot))}` +
      ` · agents ${String(stats.completedAgents)}/${String(stats.totalAgents)} · running ${String(stats.runningAgents)}${errors}`,
    width,
  );
}

function phaseLine(snapshot: WorkflowSnapshot, width: number, theme: ProgressTheme): string[] {
  if (!snapshot.phases.length) return [];
  return [
    fit(`  ${theme.fg("muted", "phases")} ${snapshot.phases.map((phase, index) => `P${String(index + 1)} ${phase}`).join(" · ")}`, width),
  ];
}

function agentLines(agents: WorkflowAgentSnapshot[], width: number, theme: ProgressTheme): string[] {
  const selected = agents.filter((agent) => agent.status !== "done").slice(0, MAX_VISIBLE_AGENTS);
  const hidden = agents.length - selected.length;
  return [
    ...selected.map((agent) => agentLine(agent, width, theme)),
    ...(hidden > 0 ? [fit(`  ${theme.fg("dim", `${String(hidden)} completed/hidden agents`)}`, width)] : []),
  ];
}

function agentLine(agent: WorkflowAgentSnapshot, width: number, theme: ProgressTheme): string {
  const color = agent.status === "error" ? "error" : agent.status === "done" ? "success" : "warning";
  const meta = [
    agent.reasoning ?? "default",
    agent.model,
    `${formatTokenCount(agent.inputTokenCount)} in`,
    `${formatTokenCount(agent.outputTokenCount)} out`,
    `${String(agent.toolCallCount)} tools`,
    agent.status === "running" ? `${String(agent.stepCount)} steps` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
  return fit(`  ${theme.fg(color, agent.status.toUpperCase())} #${String(agent.id)} ${agent.label} · ${meta}`, width);
}

function netLine(snapshot: WorkflowSnapshot, stats: NetStats, width: number, theme: ProgressTheme): string {
  const totalTokenCount = stats.inputTokenCount + stats.outputTokenCount;
  return fit(
    `  ${theme.fg("muted", "NET")} ${String(stats.completedAgents)}/${String(stats.totalAgents)} agents · ` +
      `${formatTokenCount(stats.inputTokenCount)} in · ${formatTokenCount(stats.outputTokenCount)} out · ` +
      `${formatTokenCount(totalTokenCount)} total · ${String(stats.toolCallCount)} tools · ` +
      `${String(snapshot.fanOuts.length)} ${snapshot.fanOuts.length === 1 ? "fanout" : "fanouts"}`,
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

interface WorkflowDisplayState {
  label: string;
  color: DisplayColor;
}

function workflowState(snapshot: WorkflowSnapshot, stats: NetStats): WorkflowDisplayState {
  if (stats.erroredAgents > 0 || snapshot.status === "error") return { label: "ERROR", color: "error" };
  if (snapshot.status === "done") return { label: "DONE", color: "success" };
  return { label: "RUNNING", color: "warning" };
}

function currentPhase(snapshot: WorkflowSnapshot): string {
  const title = snapshot.phases.at(-1);
  return title ? `P${String(snapshot.phases.length)} ${title}` : "setup";
}
