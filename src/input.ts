/** Parses direct workflow command input as JSON/key-value data or returns freeform text for agent resolution. */
export function parseWorkflowInput(text: string): { action: "use"; input: unknown } | { action: "resolve"; rawInput: string } {
  const trimmed = text.trim();
  if (!trimmed) return { action: "use", input: {} };
  const json = parseJsonInput(trimmed);
  if (json.ok) return { action: "use", input: json.value };
  const keyValueInput = parseKeyValueInput(trimmed);
  if (keyValueInput) return { action: "use", input: keyValueInput };
  return { action: "resolve", rawInput: trimmed };
}

function parseJsonInput(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function parseKeyValueInput(text: string): Record<string, unknown> | undefined {
  const tokens = tokenizeInput(text);
  const input: Record<string, unknown> = {};
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.startsWith("--") && token.length > 2) {
      const raw = token.slice(2);
      const equalsIndex = raw.indexOf("=");
      if (equalsIndex >= 0) {
        addInputValue(input, raw.slice(0, equalsIndex), coerceInputValue(raw.slice(equalsIndex + 1)));
        continue;
      }
      const next = tokens[index + 1];
      if (next && !next.startsWith("--") && !isKeyValueToken(next)) {
        addInputValue(input, raw, coerceInputValue(next));
        index++;
        continue;
      }
      addInputValue(input, raw, true);
      continue;
    }

    if (isKeyValueToken(token)) {
      const equalsIndex = token.indexOf("=");
      addInputValue(input, token.slice(0, equalsIndex), coerceInputValue(token.slice(equalsIndex + 1)));
      continue;
    }

    positional.push(token);
  }

  if (!Object.keys(input).length) return undefined;
  if (positional.length) addInputValue(input, "prompt", positional.join(" "));
  return input;
}

function tokenizeInput(text: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
        continue;
      }
      token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += character;
  }
  if (escaped) token += "\\";
  if (token) tokens.push(token);
  return tokens;
}

function isKeyValueToken(token: string): boolean {
  return /^[A-Za-z_][\w.-]*=/.test(token);
}

function addInputValue(input: Record<string, unknown>, key: string, value: unknown): void {
  if (!key) return;
  if (!(key in input)) {
    input[key] = value;
    return;
  }
  const existing = input[key];
  if (Array.isArray(existing)) {
    input[key] = [...(existing as unknown[]), value];
    return;
  }
  input[key] = [existing, value];
}

function coerceInputValue(value: string): unknown {
  if (value.includes(",")) return value.split(",").map((part) => coerceInputValue(part.trim()));
  const json = parseJsonInput(value);
  if (json.ok) return json.value;
  return value;
}
