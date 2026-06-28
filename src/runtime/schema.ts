import { Value } from "typebox/value";
import type { TSchema } from "typebox";

export type JsonResponseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function normalizeAttemptCount(maxAttempts: number | undefined, primitive: string): number {
  if (maxAttempts === undefined) return 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(`${primitive} maxAttempts must be a positive integer`);
  return maxAttempts;
}

export function parseAndValidateJsonResponse(response: unknown, schema: unknown): JsonResponseResult {
  const parsed = parseJsonResponse(response);
  if (!parsed.ok) return parsed;
  if (Value.Check(schema as TSchema, parsed.value)) return parsed;
  return { ok: false, error: schemaValidationFailure(schema, parsed.value) };
}

export function parseJsonResponse(response: unknown): JsonResponseResult {
  if (response !== null && typeof response === "object") return { ok: true, value: response };
  if (typeof response !== "string") return { ok: false, error: `response was ${typeof response}, not JSON text` };
  const trimmed = response.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced?.[1] ?? trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function jsonSchemaPrompt(instruction: string, task: string, schema: unknown, validationFailure: string | undefined): string {
  return [
    instruction,
    `Schema:\n${JSON.stringify(schema)}`,
    `Task:\n${task}`,
    ...(validationFailure ? [`Previous response failed validation:\n${validationFailure}\nReturn corrected JSON only.`] : []),
  ].join("\n\n");
}

function schemaValidationFailure(schema: unknown, value: unknown): string {
  const errors = [...Value.Errors(schema as TSchema, value)].slice(0, 5).map((error) => `${error.instancePath || "/"} ${error.message}`);
  return errors.length ? errors.join("; ") : "response did not match schema";
}
