import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export function parseSessionTokens(sessionDir: string): TokenUsage | null {
  const sessionFile = findLatestSessionFile(sessionDir);
  if (!sessionFile) return null;
  try {
    let input = 0;
    let output = 0;
    for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { usage?: unknown; message?: { usage?: unknown } };
        const usage = normalizeTokenUsage(entry.usage ?? entry.message?.usage);
        if (usage) {
          input += usage.input;
          output += usage.output;
        }
      } catch {
        // Ignore malformed lines while scanning usage entries.
      }
    }
    return { input, output, total: input + output };
  } catch {
    return null;
  }
}

export function workflowTokenUsageFromMessage(value: unknown): { inputTokenCount: number; outputTokenCount: number } {
  if (typeof value !== "object" || value === null) return { inputTokenCount: 0, outputTokenCount: 0 };
  const usage = normalizeTokenUsage((value as { usage?: unknown }).usage);
  return usage ? { inputTokenCount: usage.input, outputTokenCount: usage.output } : { inputTokenCount: 0, outputTokenCount: 0 };
}

function normalizeTokenUsage(value: unknown): { input: number; output: number } | null {
  if (typeof value !== "object" || value === null) return null;
  return {
    input: tokenProperty(value, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "inputTokenCount"]),
    output: tokenProperty(value, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens", "outputTokenCount"]),
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
