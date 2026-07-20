/** Provides session usage behavior. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { WorkflowCost } from "../runtime/types.ts";

export interface TokenUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
  cost: WorkflowCost;
}

/** Provides the parseSessionTokens function contract. */
export function parseSessionTokens(sessionDir: string): TokenUsage | null {
  const sessionFile = findLatestSessionFile(sessionDir);
  if (!sessionFile) return null;
  try {
    let input = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let output = 0;
    let costUsd = 0;
    let costComplete = true;
    let observedUsage = false;
    for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { usage?: unknown; message?: { usage?: unknown } };
        const usage = normalizeTokenUsage(entry.usage ?? entry.message?.usage);
        if (usage) {
          observedUsage = true;
          input += usage.input;
          cacheRead += usage.cacheRead;
          cacheWrite += usage.cacheWrite;
          output += usage.output;
          if (usage.costUsd === undefined) costComplete = false;
          else costUsd += usage.costUsd;
        }
      } catch {
        // Ignore malformed lines while scanning usage entries.
      }
    }
    return {
      input,
      cacheRead,
      cacheWrite,
      output,
      total: input + output,
      cost: { knownUsd: costUsd, complete: observedUsage && costComplete },
    };
  } catch {
    return null;
  }
}

/** Provides the workflowTokenUsageFromMessage function contract. */
export function workflowTokenUsageFromMessage(value: unknown): {
  inputTokenCount: number;
  cacheReadTokenCount: number;
  outputTokenCount: number;
  costUsd?: number;
} {
  if (typeof value !== "object" || value === null) return { inputTokenCount: 0, cacheReadTokenCount: 0, outputTokenCount: 0 };
  const usage = normalizeTokenUsage((value as { usage?: unknown }).usage);
  return usage
    ? {
        inputTokenCount: usage.input,
        cacheReadTokenCount: usage.cacheRead,
        outputTokenCount: usage.output,
        ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
      }
    : { inputTokenCount: 0, cacheReadTokenCount: 0, outputTokenCount: 0 };
}

function normalizeTokenUsage(
  value: unknown,
): { input: number; cacheRead: number; cacheWrite: number; output: number; costUsd?: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const properties = value as Record<string, unknown>;
  const cost = properties.cost;
  return {
    input: tokenProperty(value, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "inputTokenCount"]),
    cacheRead: tokenProperty(value, ["cacheRead", "cache_read", "cacheReadTokens", "cache_read_tokens", "cache_read_input_tokens"]),
    cacheWrite: tokenProperty(value, ["cacheWrite", "cache_write", "cacheWriteTokens", "cache_write_tokens"]),
    output: tokenProperty(value, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens", "outputTokenCount"]),
    ...(typeof cost === "object" &&
    cost !== null &&
    typeof (cost as { total?: unknown }).total === "number" &&
    Number.isFinite((cost as { total: number }).total)
      ? { costUsd: (cost as { total: number }).total }
      : {}),
  };
}

function tokenProperty(value: object, keys: string[]): number {
  const properties = value as Record<string, unknown>;
  for (const key of keys) {
    const tokenValue = properties[key];
    if (typeof tokenValue === "number" && Number.isFinite(tokenValue)) return tokenValue;
  }
  return 0;
}

function findLatestSessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined;
  return readdirSync(sessionDir)
    .filter((file) => file.endsWith(".jsonl") && file !== "events.jsonl")
    .map((file) => path.join(sessionDir, file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
}
