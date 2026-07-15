/** Provides workflow tui format behavior. */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface PiThemeLike {
  fg(color: "accent" | "borderMuted" | "dim" | "error" | "muted" | "success" | "warning", text: string): string;
  bg?(color: "selectedBg", text: string): string;
  bold(text: string): string;
}

export interface WorkflowTuiTheme {
  accent(text: string): string;
  dim(text: string): string;
  ok(text: string): string;
  warn(text: string): string;
  danger(text: string): string;
  pending(text: string): string;
  border(text: string): string;
  bold(text: string): string;
  selected(text: string): string;
}

export const plainWorkflowTuiTheme: WorkflowTuiTheme = {
  accent: (text) => text,
  dim: (text) => text,
  ok: (text) => text,
  warn: (text) => text,
  danger: (text) => text,
  pending: (text) => text,
  border: (text) => text,
  bold: (text) => text,
  selected: (text) => text,
};

/** Provides the workflowTuiTheme function contract. */
export function workflowTuiTheme(theme: PiThemeLike): WorkflowTuiTheme {
  return {
    accent: (text) => theme.fg("accent", text),
    dim: (text) => theme.fg("dim", text),
    ok: (text) => theme.fg("success", text),
    warn: (text) => theme.fg("warning", text),
    danger: (text) => theme.fg("error", text),
    pending: (text) => theme.fg("muted", text),
    border: (text) => theme.fg("borderMuted", text),
    bold: (text) => theme.bold(text),
    selected: (text) => theme.bg?.("selectedBg", text) ?? text,
  };
}

export const glyph = {
  done: "✔",
  idle: "○",
  marker: "›",
  spinner: ["◐", "◓", "◑", "◒"],
  arrowDown: "↓",
  arrowUp: "↑",
  updown: "↕",
  enter: "⏎",
  mid: "·",
};

/** Provides the spinnerFrame function contract. */
export function spinnerFrame(tick: number): string {
  return glyph.spinner[tick % glyph.spinner.length] ?? glyph.spinner[0];
}

/** Provides the fmtTokens function contract. */
export function fmtTokens(tokenCount: number): string {
  if (tokenCount < 1000) return String(tokenCount);
  if (tokenCount < 1_000_000) return `${stripZero(tokenCount / 1000)}k`;
  return `${stripZero(tokenCount / 1_000_000)}m`;
}

/** Provides the fmtCostUsd function contract. */
export function fmtCostUsd(costUsd: number, incomplete = false): string {
  return `$${costUsd.toFixed(2)}${incomplete ? "+" : ""}`;
}

function stripZero(value: number): string {
  const rendered = value.toFixed(1);
  return rendered.endsWith(".0") ? rendered.slice(0, -2) : rendered;
}

/** Provides the fmtDuration function contract. */
export function fmtDuration(totalSeconds: number, spaced = false): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)}s`;
  return spaced ? `${String(minutes)}m ${String(seconds)}s` : `${String(minutes)}m${String(seconds)}s`;
}

/** Provides the width function contract. */
export function width(text: string): number {
  return visibleWidth(text);
}

/** Provides the padTo function contract. */
export function padTo(text: string, targetWidth: number): string {
  const currentWidth = visibleWidth(text);
  if (currentWidth === targetWidth) return text;
  if (currentWidth < targetWidth) return text + " ".repeat(targetWidth - currentWidth);
  return truncateToWidth(text, targetWidth, "");
}

/** Provides the truncEnd function contract. */
export function truncEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  return truncateToWidth(text, maxWidth, "…");
}

/** Provides the panel function contract. */
export function panel(theme: WorkflowTuiTheme, title: string, body: string[], panelWidth: number, panelHeight: number): string[] {
  const innerWidth = Math.max(0, panelWidth - 2);
  const titleText = ` ${title} `;
  const titleSegment = ` ${theme.accent(theme.bold(title))} `;
  const dashCount = Math.max(0, innerWidth - visibleWidth(titleText));
  const lines = [theme.border("┌") + titleSegment + theme.border(`${"─".repeat(dashCount)}┐`)];
  for (let index = 0; index < panelHeight - 2; index++) {
    lines.push(theme.border("│") + padTo(body[index] ?? "", innerWidth) + theme.border("│"));
  }
  lines.push(theme.border(`└${"─".repeat(innerWidth)}┘`));
  return lines;
}

/** Provides the joinColumns function contract. */
export function joinColumns(left: string[], right: string[]): string[] {
  const height = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let index = 0; index < height; index++) lines.push((left[index] ?? "") + (right[index] ?? ""));
  return lines;
}
