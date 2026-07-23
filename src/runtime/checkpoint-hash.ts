/** Creates stable hashes for normalized workflow model-call requests. */
import { createHash } from "node:crypto";

/** Returns a SHA-256 hash for a JSON-compatible request with deterministically sorted object keys. */
export function checkpointHash(request: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortJsonValue(request)))
    .digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
  );
}
