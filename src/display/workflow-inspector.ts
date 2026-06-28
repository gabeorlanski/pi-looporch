import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkflowAgentSnapshot, WorkflowSnapshot, WorkflowToolCallSnapshot } from "../runtime.ts";
import { workflowPhaseViews } from "./workflow-phases.ts";
import { formatDuration, formatTokenCount, type ProgressTheme } from "./progress.ts";

export type WorkflowInspectorLevel = "chat" | "phases" | "detail";
export type WorkflowInspectorInput = "down" | "enter" | "escape" | "left" | "right" | "scrollDown" | "scrollUp" | "up";

export interface WorkflowInspectorState {
  level: WorkflowInspectorLevel;
  selectedPhaseIdx: number;
  selectedAgentIdx: number;
  promptExpanded: boolean;
  contentScrollOffset: number;
  focusedLink: string | null;
}

interface InspectorPhase {
  index: number;
  title: string;
  status: "done" | "pending" | "running";
  agents: WorkflowAgentSnapshot[];
}

const MIN_WIDTH = 72;
const HEADER_LINES = 2;
const FOOTER_LINES = 1;
const LEFT_WIDTH = 26;
const PANEL_GUTTER = 1;
const plainTheme: ProgressTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

export function defaultWorkflowInspectorState(): WorkflowInspectorState {
  return { level: "chat", selectedPhaseIdx: 0, selectedAgentIdx: 0, promptExpanded: false, contentScrollOffset: 0, focusedLink: null };
}

export function reduceWorkflowInspectorState(
  state: WorkflowInspectorState,
  snapshot: WorkflowSnapshot,
  input: WorkflowInspectorInput,
): WorkflowInspectorState {
  const phases = workflowPhases(snapshot);
  const selectedPhaseIdx = clamp(state.selectedPhaseIdx, 0, Math.max(0, phases.length - 1));
  const agents = phases[selectedPhaseIdx]?.agents ?? [];
  const selectedAgentIdx = clamp(state.selectedAgentIdx, 0, Math.max(0, agents.length - 1));
  const normalized = { ...state, selectedPhaseIdx, selectedAgentIdx };
  if (normalized.level === "chat") return reduceChatState(normalized, input);
  if (normalized.level === "phases") return reducePhasesState(normalized, phases.length, agents.length, input);
  return reduceDetailState(normalized, agents.length, input);
}

export function renderCollapsedWorkflowWidget(snapshot: WorkflowSnapshot, width = 96, theme: ProgressTheme = plainTheme): string[] {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const stats = workflowStats(snapshot);
  const statusGlyph = snapshot.result === undefined && stats.runningAgents > 0 ? "◐" : "○";
  const right = `${String(stats.completedAgents)}/${String(stats.totalAgents)} agents done · ${formatHeaderDuration(workflowElapsedMs(snapshot))} · ↓${formatTokenCount(stats.tokenCount).toLowerCase()} tokens`;
  const prefix = `${statusGlyph} ${theme.fg("accent", theme.bold(snapshot.workflowName))}  `;
  const availableSubtitle = Math.max(0, safeWidth - visibleWidth(prefix) - visibleWidth(right) - 2);
  const subtitle = theme.fg("dim", fit(snapshot.description, availableSubtitle));
  const spacer = " ".repeat(Math.max(1, safeWidth - visibleWidth(prefix) - visibleWidth(subtitle) - visibleWidth(right)));
  return [theme.fg("dim", fit("← for agents", safeWidth)), fit(`${prefix}${subtitle}${spacer}${right}`, safeWidth)];
}

export function renderWorkflowInspector(
  snapshot: WorkflowSnapshot,
  state: WorkflowInspectorState,
  width = 120,
  height = 28,
  theme: ProgressTheme = plainTheme,
): string[] {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const normalized = normalizeState(state, snapshot);
  if (normalized.level === "chat") return fill(renderCollapsedWorkflowWidget(snapshot, safeWidth, theme), safeWidth, Math.max(2, height));
  const safeHeight = Math.max(8, height);
  const bodyHeight = safeHeight - HEADER_LINES - FOOTER_LINES;
  const header = inspectorHeader(snapshot, safeWidth, theme);
  const body =
    normalized.level === "phases"
      ? renderPhasesScreen(snapshot, normalized, safeWidth, bodyHeight, theme)
      : renderDetailScreen(snapshot, normalized, safeWidth, bodyHeight, theme);
  const footer =
    normalized.level === "phases"
      ? "↕ select · x stop workflow · p pause · esc back · s save"
      : "↑↓ agent · j/k scroll · ⏎ prompt · p pause · esc back · s save";
  return [...header, ...body, theme.fg("dim", fit(footer, safeWidth))];
}

function reduceChatState(state: WorkflowInspectorState, input: WorkflowInspectorInput): WorkflowInspectorState {
  if (input === "enter" || input === "left" || input === "right") return { ...state, level: "phases" };
  return state;
}

function reducePhasesState(
  state: WorkflowInspectorState,
  phaseCount: number,
  selectedPhaseAgentCount: number,
  input: WorkflowInspectorInput,
): WorkflowInspectorState {
  if (input === "escape") return { ...state, level: "chat" };
  if (input === "up") return { ...state, selectedPhaseIdx: clamp(state.selectedPhaseIdx - 1, 0, Math.max(0, phaseCount - 1)) };
  if (input === "down") return { ...state, selectedPhaseIdx: clamp(state.selectedPhaseIdx + 1, 0, Math.max(0, phaseCount - 1)) };
  if ((input === "right" || input === "enter") && selectedPhaseAgentCount > 0)
    return { ...state, level: "detail", selectedAgentIdx: 0, contentScrollOffset: 0, promptExpanded: false };
  return state;
}

function reduceDetailState(state: WorkflowInspectorState, agentCount: number, input: WorkflowInspectorInput): WorkflowInspectorState {
  if (input === "escape") return { ...state, level: "phases" };
  if (input === "up")
    return {
      ...state,
      selectedAgentIdx: clamp(state.selectedAgentIdx - 1, 0, Math.max(0, agentCount - 1)),
      contentScrollOffset: 0,
      promptExpanded: false,
    };
  if (input === "down")
    return {
      ...state,
      selectedAgentIdx: clamp(state.selectedAgentIdx + 1, 0, Math.max(0, agentCount - 1)),
      contentScrollOffset: 0,
      promptExpanded: false,
    };
  if (input === "scrollDown") return { ...state, contentScrollOffset: state.contentScrollOffset + 1 };
  if (input === "scrollUp") return { ...state, contentScrollOffset: Math.max(0, state.contentScrollOffset - 1) };
  if (input === "enter") return { ...state, promptExpanded: !state.promptExpanded };
  return state;
}

function normalizeState(state: WorkflowInspectorState, snapshot: WorkflowSnapshot): WorkflowInspectorState {
  const phases = workflowPhases(snapshot);
  const selectedPhaseIdx = clamp(state.selectedPhaseIdx, 0, Math.max(0, phases.length - 1));
  const agents = phases[selectedPhaseIdx]?.agents ?? [];
  return { ...state, selectedPhaseIdx, selectedAgentIdx: clamp(state.selectedAgentIdx, 0, Math.max(0, agents.length - 1)) };
}

function inspectorHeader(snapshot: WorkflowSnapshot, width: number, theme: ProgressTheme): string[] {
  const stats = workflowStats(snapshot);
  const right = `${String(stats.completedAgents)}/${String(stats.totalAgents)} agents · ${formatHeaderDuration(workflowElapsedMs(snapshot))}`;
  const name = theme.fg("accent", theme.bold(snapshot.workflowName));
  const spacer = " ".repeat(Math.max(1, width - visibleWidth(name) - visibleWidth(right)));
  return [fit(`${name}${spacer}${right}`, width), theme.fg("dim", fit(snapshot.description, width))];
}

function renderPhasesScreen(
  snapshot: WorkflowSnapshot,
  state: WorkflowInspectorState,
  width: number,
  height: number,
  theme: ProgressTheme,
): string[] {
  const phases = workflowPhases(snapshot);
  const selected = phases[state.selectedPhaseIdx];
  const leftRows = phases.map((phase, index) => phaseRow(phase, index === state.selectedPhaseIdx, theme));
  const rightRows = selected.agents.map((agent) => agentPreviewRow(agent, theme));
  return renderTwoPanels(
    "Phases",
    leftRows,
    `${selected.title} · ${String(selected.agents.length)} agents`,
    rightRows,
    width,
    height,
    theme,
  );
}

function renderDetailScreen(
  snapshot: WorkflowSnapshot,
  state: WorkflowInspectorState,
  width: number,
  height: number,
  theme: ProgressTheme,
): string[] {
  const phases = workflowPhases(snapshot);
  const phase = phases[state.selectedPhaseIdx];
  const agents = phase.agents;
  const leftRows = agents.map((candidate, index) => detailAgentRow(candidate, index === state.selectedAgentIdx, theme));
  if (agents.length === 0)
    return renderTwoPanels(
      `${phase.title} · 0 agents`,
      leftRows,
      "agent detail",
      [theme.fg("dim", "No agents in this phase yet.")],
      width,
      height,
      theme,
    );
  const agent = agents[state.selectedAgentIdx];
  const detailRows = agentDetailRows(agent, state, Math.max(32, width - LEFT_WIDTH - PANEL_GUTTER - 2), Math.max(1, height - 2), theme);
  return renderTwoPanels(`${phase.title} · ${String(agents.length)} agents`, leftRows, agent.label, detailRows, width, height, theme);
}

function renderTwoPanels(
  leftTitle: string,
  leftRows: string[],
  rightTitle: string,
  rightRows: string[],
  width: number,
  height: number,
  theme: ProgressTheme,
): string[] {
  const leftWidth = Math.min(LEFT_WIDTH, Math.max(20, Math.floor(width * 0.35)));
  const rightWidth = Math.max(20, width - leftWidth - PANEL_GUTTER);
  const left = panel(leftTitle, leftRows, leftWidth, height, theme);
  const right = panel(rightTitle, rightRows, rightWidth, height, theme);
  return Array.from({ length: height }, (_unused, index) => `${left[index] ?? ""}${" ".repeat(PANEL_GUTTER)}${right[index] ?? ""}`);
}

function panel(title: string, rows: string[], width: number, height: number, theme: ProgressTheme): string[] {
  const inner = Math.max(1, width - 2);
  const topTitle = ` ${fit(title, Math.max(1, inner - 2))} `;
  const top = `┌${topTitle}${"─".repeat(Math.max(0, inner - visibleWidth(topTitle)))}┐`;
  const bottom = `└${"─".repeat(inner)}┘`;
  const visibleRows = rows.slice(0, Math.max(0, height - 2));
  const body = visibleRows.map((row) => `│${pad(fit(row, inner), inner)}│`);
  while (body.length < height - 2) body.push(`│${" ".repeat(inner)}│`);
  return [theme.fg("borderMuted", top), ...body, theme.fg("borderMuted", bottom)];
}

function phaseRow(phase: InspectorPhase, selected: boolean, theme: ProgressTheme): string {
  const marker = selected ? theme.fg("accent", "›") : " ";
  const glyph = phaseGlyph(phase, theme);
  const count = phase.status === "pending" ? "" : `${String(completedAgents(phase.agents))}/${String(phase.agents.length)}`;
  return `${marker}${glyph} ${phase.title}${count ? ` ${count}` : ""}`;
}

function agentPreviewRow(agent: WorkflowAgentSnapshot, theme: ProgressTheme): string {
  return `${agentGlyph(agent, theme)} ${agent.label}  ${theme.fg("dim", agent.model ?? "default")}  ${formatTokenCount(agent.tokenCount).toLowerCase()} tok · ${String(agent.toolCallCount)} tools · ${agentDuration(agent)}`;
}

function detailAgentRow(agent: WorkflowAgentSnapshot, selected: boolean, theme: ProgressTheme): string {
  return `${selected ? theme.fg("accent", "›") : " "}${agentGlyph(agent, theme)} ${agent.label}`;
}

function agentDetailRows(
  agent: WorkflowAgentSnapshot,
  state: WorkflowInspectorState,
  width: number,
  viewport: number,
  theme: ProgressTheme,
): string[] {
  const promptLines = (agent.promptPreview ?? "(prompt unavailable)").split("\n");
  const promptLineCount = agent.promptLineCount ?? promptLines.length;
  const promptBody = state.promptExpanded
    ? promptLines.map((line) => `  ${line}`)
    : [`  ${promptLines[0] ?? ""}`, ...(promptLineCount > 1 ? [`  … ${String(promptLineCount - 1)} more lines`] : [])];
  const activity = agent.recentToolCalls ?? [];
  const outcomeLines = outcomeText(agent)
    .split("\n")
    .map((line) => `  ${line}`);
  const allRows = [
    `${agentGlyph(agent, theme)} ${agentStatusText(agent)} · ${agent.model ?? "default"}`,
    theme.fg(
      "dim",
      `${formatTokenCount(agent.tokenCount).toLowerCase()} tok · ${String(agent.toolCallCount)} tool calls · ${agentDuration(agent)}`,
    ),
    "",
    `Prompt · ${String(promptLineCount)} lines${state.promptExpanded ? "" : " · ⏎ expand"}`,
    ...promptBody,
    "",
    `Activity · last ${String(activity.length)} of ${String(agent.toolCallCount)} tool calls`,
    ...(activity.length
      ? activity.map((toolCall) => `  ${toolCallText(toolCall)}`)
      : [theme.fg("dim", "  (no tool activity captured yet)")]),
    "",
    "Outcome",
    ...outcomeLines,
  ];
  const safeViewport = Math.max(1, viewport - 1);
  const maxScroll = Math.max(0, allRows.length - safeViewport);
  const start = clamp(state.contentScrollOffset, 0, maxScroll);
  const visible = allRows.slice(start, start + safeViewport).map((line) => fit(line, width));
  const first = allRows.length === 0 ? 0 : start + 1;
  const last = Math.min(allRows.length, start + visible.length);
  const arrow = allRows.length <= viewport ? "" : last < allRows.length ? " ↓" : " ↑";
  return [...visible, theme.fg("dim", pad(`${String(first)}–${String(last)} of ${String(allRows.length)}${arrow}`, width))];
}

function workflowPhases(snapshot: WorkflowSnapshot): InspectorPhase[] {
  return workflowPhaseViews(snapshot, { includePlanned: true }).map((phase) => {
    if (phase.agents.some((agent) => agent.status === "running")) return { ...phase, status: "running" };
    if (phase.agents.length > 0 || phase.isStarted || snapshot.result !== undefined) return { ...phase, status: "done" };
    return { ...phase, status: "pending" };
  });
}

function workflowStats(snapshot: WorkflowSnapshot): {
  completedAgents: number;
  runningAgents: number;
  tokenCount: number;
  totalAgents: number;
} {
  const completedAgents = snapshot.agents.filter((agent) => agent.status !== "running").length;
  return {
    completedAgents,
    runningAgents: snapshot.agents.length - completedAgents,
    tokenCount: snapshot.agents.reduce((total, agent) => total + agent.tokenCount, 0),
    totalAgents: snapshot.agents.length,
  };
}

function phaseGlyph(phase: InspectorPhase, theme: ProgressTheme): string {
  if (phase.status === "done") return theme.fg("success", "✔");
  if (phase.status === "running") return theme.fg("warning", "◐");
  return theme.fg("dim", String(phase.index));
}

function agentGlyph(agent: WorkflowAgentSnapshot, theme: ProgressTheme): string {
  if (agent.status === "done") return theme.fg("success", "✔");
  if (agent.status === "error") return theme.fg("error", "✗");
  return theme.fg("warning", "◐");
}

function agentStatusText(agent: WorkflowAgentSnapshot): string {
  if (agent.status === "done") return "Completed";
  if (agent.status === "error") return "Failed";
  return "Running";
}

function completedAgents(agents: WorkflowAgentSnapshot[]): number {
  return agents.filter((agent) => agent.status !== "running").length;
}

function workflowElapsedMs(snapshot: WorkflowSnapshot): number {
  const started = snapshot.agents.filter((agent) => agent.startedAt > 0).map((agent) => agent.startedAt);
  if (started.length === 0) return 0;
  const ended = snapshot.result === undefined ? Date.now() : Math.max(...snapshot.agents.map((agent) => agent.endedAt ?? agent.startedAt));
  return Math.max(0, ended - Math.min(...started));
}

function agentDuration(agent: WorkflowAgentSnapshot): string {
  if (agent.startedAt <= 0) return "0s";
  const endedAt = agent.endedAt ?? Date.now();
  return formatDuration(endedAt - agent.startedAt);
}

function formatHeaderDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes)}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

function outcomeText(agent: WorkflowAgentSnapshot): string {
  if (agent.outputPreview)
    return agent.outputPath ? `${agent.outputPreview}\n\nOutput written to ${agent.outputPath}` : agent.outputPreview;
  if (agent.outputPath) return `Output written to ${agent.outputPath}`;
  if (agent.error) return agent.error;
  return "(no outcome yet)";
}

function toolCallText(toolCall: WorkflowToolCallSnapshot): string {
  return `${toolCall.tool}(${truncateMiddle(toolCall.args, 72)})`;
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const keep = Math.max(1, Math.floor((maxLength - 1) / 2));
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`;
}

function fill(lines: string[], width: number, height: number): string[] {
  const rendered = lines.slice(0, height).map((line) => fit(line, width));
  while (rendered.length < height) rendered.push("");
  return rendered;
}

function fit(text: string, width: number): string {
  if (width <= 0) return "";
  if (!text.includes("\u001B")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
  return truncateToWidth(text, width, "…");
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
