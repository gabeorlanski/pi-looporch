/** Provides text behavior. */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ProgressTheme } from "./progress.ts";

/** Provides the fit function contract. */
export function fit(text: string, width: number, ellipsis = "..."): string {
  if (!text.includes("\u001B")) return text.length <= width ? text : `${text.slice(0, Math.max(0, width - ellipsis.length))}${ellipsis}`;
  return truncateToWidth(text, width, ellipsis);
}

/** Provides the titleLine function contract. */
export function titleLine(title: string, width: number, theme: ProgressTheme, ellipsis = "..."): string {
  const label = ` ${title} `;
  const fillLen = Math.max(0, width - visibleWidth(label) - 4);
  return fit(
    theme.fg("borderMuted", "──") + theme.fg("accent", theme.bold(label)) + theme.fg("borderMuted", "─".repeat(fillLen)),
    width,
    ellipsis,
  );
}

/** Provides the trimFixed function contract. */
export function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
