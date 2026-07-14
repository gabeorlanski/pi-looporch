/** Provides session transcript behavior. */
import { closeSync, openSync, readSync, statSync } from "node:fs";

const MAX_TRANSCRIPT_BYTES = 1_000_000;

/** Provides the loadSessionMessages function contract. */
export function loadSessionMessages(sessionFile: string): unknown[] {
  const text = readSessionTail(sessionFile);
  if (!text) return [];
  const messages: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const message = messageFromJsonLine(line);
    if (message !== undefined) messages.push(message);
  }
  return messages;
}

function readSessionTail(sessionFile: string): string {
  try {
    const stats = statSync(sessionFile);
    if (!stats.isFile()) return "";
    const start = Math.max(0, stats.size - MAX_TRANSCRIPT_BYTES);
    const buffer = Buffer.alloc(stats.size - start);
    const fd = openSync(sessionFile, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    const text = buffer.toString("utf8");
    if (start === 0) return text;
    const firstNewline = text.indexOf("\n");
    return firstNewline === -1 ? "" : text.slice(firstNewline + 1);
  } catch {
    return "";
  }
}

function messageFromJsonLine(line: string): unknown {
  try {
    const entry = JSON.parse(line) as { message?: unknown };
    return entry.message;
  } catch {
    return undefined;
  }
}
