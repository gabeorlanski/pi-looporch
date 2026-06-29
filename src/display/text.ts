import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ProgressTheme } from "./progress.ts";

export function fit(text: string, width: number, ellipsis = "..."): string {
  if (!text.includes("\u001B")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - ellipsis.length))}${ellipsis}`;
  return truncateToWidth(text, width, ellipsis);
}

export function titleLine(title: string, width: number, theme: ProgressTheme, ellipsis = "..."): string {
  const label = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(label) - 4);
  return fit(
    theme.fg("borderMuted", "──") + theme.fg("accent", theme.bold(label)) + theme.fg("borderMuted", "─".repeat(fillLen)),
    width,
    ellipsis,
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatCharCount(count: number): string {
  if (count < 1000) return `${String(count)} chars`;
  if (count < 1_000_000) return `${trimFixed(count / 1000)}k chars`;
  return `${trimFixed(count / 1_000_000)}M chars`;
}
