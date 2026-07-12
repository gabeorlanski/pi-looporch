/** Formats any value for a bounded prompt, diagnostic, or trace without throwing. */
export function boundedJson(value: unknown, maxLength: number): string {
  let text: string;
  try {
    const serialized: unknown = JSON.stringify(value);
    text = typeof serialized === "string" ? serialized : String(value);
  } catch {
    try {
      text = String(value);
    } catch {
      text = "[unprintable value]";
    }
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export type ParsedJsonResponse = { ok: true; value: unknown } | { ok: false; error: string };

/** Parses exact JSON, a single exact markdown fence, or one object/array embedded in prose. */
export function parseJsonResponse(response: unknown): ParsedJsonResponse {
  if (response !== null && typeof response === "object") return { ok: true, value: response };
  if (typeof response !== "string") return { ok: false, error: `response was ${typeof response}, not JSON text` };
  const text = response.trim();
  const exact = parseExactJson(text);
  if (exact.ok) return exact;
  const fenced = fencedJson(text);
  if (fenced !== undefined) return parseExactJson(fenced);
  return parseEmbeddedJsonContainer(text);
}

function parseExactJson(text: string): ParsedJsonResponse {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function fencedJson(text: string): string | undefined {
  return /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)?.[1];
}

function parseEmbeddedJsonContainer(text: string): ParsedJsonResponse {
  const candidates: unknown[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    const end = jsonContainerEnd(text, index);
    if (end === undefined) return { ok: false, error: "response contains an incomplete JSON object or array" };
    try {
      candidates.push(JSON.parse(text.slice(index, end + 1)) as unknown);
    } catch {
      // Skip malformed containers as a unit so nested JSON cannot become a response.
    }
    index = end;
  }
  if (candidates.length === 1) return { ok: true, value: candidates[0] };
  if (candidates.length > 1) return { ok: false, error: "response contains multiple JSON object or array values; return exactly one" };
  return { ok: false, error: "response contains no complete JSON object or array" };
}

function jsonContainerEnd(text: string, start: number): number | undefined {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const opening = stack.pop();
      if ((opening === "{" && character !== "}") || (opening === "[" && character !== "]")) return undefined;
      if (stack.length === 0) return index;
    }
  }
  return undefined;
}
