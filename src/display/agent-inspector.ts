import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from "../runtime.ts";
import { formatDuration, formatTokenCount, type ProgressTheme } from "./progress.ts";

const MIN_WIDTH = 48;

type DisplayColor = Parameters<ProgressTheme["fg"]>[0];

const plainTheme: ProgressTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

/**
 * Header shown above the native agent transcript in the Alt-O inspector:
 * a title identifying the selected agent (`agent i/n · #id label`), a compact
 * metadata line, and a navigation hint. The transcript itself is rendered with
 * pi's own message components in the extension overlay.
 */
export function agentInspectorHeaderLines(
  snapshot: WorkflowSnapshot,
  selectedIndex: number,
  width = 96,
  theme: ProgressTheme = plainTheme,
): string[] {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const agents = snapshot.agents;
  if (agents.length === 0) {
    return [titleLine("agent inspector", safeWidth, theme), theme.fg("dim", fit("  No agents have launched yet. Esc close", safeWidth))];
  }
  const selected = clamp(selectedIndex, 0, agents.length - 1);
  const agent = agents[selected];
  return [
    titleLine(`agent ${String(selected + 1)}/${String(agents.length)} · #${String(agent.id)} ${agent.label}`, safeWidth, theme),
    metaLine(agent, snapshot, safeWidth, theme),
    theme.fg("dim", fit("  ◂ ▸ switch agent · ↑ ↓ scroll · Esc close", safeWidth)),
    "",
  ];
}

function metaLine(agent: WorkflowAgentSnapshot, snapshot: WorkflowSnapshot, width: number, theme: ProgressTheme): string {
  const status = agentStatus(agent);
  const fanOut = agent.fanOutId !== undefined ? snapshot.fanOuts.find((candidate) => candidate.id === agent.fanOutId) : undefined;
  const parts = [
    theme.fg("accent", phaseLabel(agent)),
    theme.fg(status.color, `${status.label}${durationText(agent)}`),
    theme.fg("muted", `${agent.model ?? "default"}/${agent.reasoning ?? "default"}`),
    theme.fg("muted", `${formatTokenCount(agent.inputTokenCount)} in · ${formatTokenCount(agent.outputTokenCount)} out`),
    theme.fg("muted", `${String(agent.toolCallCount)} ${agent.toolCallCount === 1 ? "tool" : "tools"}`),
    ...(fanOut ? [theme.fg("muted", `${fanOut.label} ${String(fanOut.done)}/${String(fanOut.total)}`)] : []),
  ];
  return fit(`  ${parts.join(theme.fg("dim", " · "))}`, width);
}

function agentStatus(agent: WorkflowAgentSnapshot): { label: string; color: DisplayColor } {
  if (agent.status === "done") return { label: "done", color: "success" };
  if (agent.status === "error") return { label: "error", color: "error" };
  return { label: "running", color: "warning" };
}

function durationText(agent: WorkflowAgentSnapshot): string {
  if (agent.startedAt <= 0) return "";
  if (agent.status === "running") return ` ${formatDuration(Date.now() - agent.startedAt)}`;
  if (agent.endedAt !== undefined) return ` ${formatDuration(agent.endedAt - agent.startedAt)}`;
  return "";
}

function phaseLabel(agent: WorkflowAgentSnapshot): string {
  if (agent.phase) return agent.phase;
  return agent.phaseIndex === 0 ? "setup" : `P${String(agent.phaseIndex)}`;
}

function titleLine(title: string, width: number, theme: ProgressTheme): string {
  const label = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(label) - 4);
  return fit(theme.fg("borderMuted", "──") + theme.fg("accent", theme.bold(label)) + theme.fg("borderMuted", "─".repeat(fillLen)), width);
}

function fit(text: string, width: number): string {
  if (!text.includes("\u001B")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`;
  return truncateToWidth(text, width, "...");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
