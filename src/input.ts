import * as ts from "typescript";

/** User-facing input validation failure for direct workflow command/tool execution. */
export class WorkflowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowInputError";
  }
}

/** Extracted workflow input contract from the default workflow function signature and JSDoc. */
export interface WorkflowInputContract {
  jsdoc?: string;
  signature?: string;
  requiredFields: string[];
  optionalFields: string[];
}

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

/** Reads workflow.js source and extracts required/optional input fields for validation and steering prompts. */
export function extractWorkflowInputContract(source: string): WorkflowInputContract {
  const sourceFile = ts.createSourceFile("workflow.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const workflow = findDefaultWorkflow(sourceFile);
  if (!workflow) return { requiredFields: [], optionalFields: [] };
  const jsdoc = extractNodeJsDoc(source, sourceFile, workflow.node) ?? extractLeadingJsDoc(source);
  const signature = workflowSignature(sourceFile, workflow.parameters);
  const fields = inputFieldsFromParameters(workflow.parameters);
  const jsdocFields = inputFieldsFromJsDoc(jsdoc ?? "");
  const optionalFields = sortedUnique([...fields.optional, ...jsdocFields.optional]);
  return {
    ...(jsdoc ? { jsdoc } : {}),
    ...(signature ? { signature } : {}),
    requiredFields: sortedUnique([...fields.required, ...jsdocFields.required]).filter((field) => !optionalFields.includes(field)),
    optionalFields,
  };
}

/** Validates normalized direct input against a workflow contract and throws an actionable WorkflowInputError on missing fields. */
export function validateWorkflowInput(input: unknown, workflowName: string, contract: WorkflowInputContract): unknown {
  if (contract.requiredFields.length === 0) return input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new WorkflowInputError(missingInputMessage(workflowName, contract.requiredFields, contract));
  }
  const record = input as Record<string, unknown>;
  const missing = contract.requiredFields.filter((field) => !(field in record) || record[field] === undefined);
  if (missing.length > 0) throw new WorkflowInputError(missingInputMessage(workflowName, missing, contract));
  return input;
}

function missingInputMessage(workflowName: string, missing: string[], contract: WorkflowInputContract): string {
  const fields = missing.join(", ");
  const examples = missing.map((field) => `${field}=<value>`).join(" ");
  return [
    `Workflow '${workflowName}' is missing required input: ${fields}.`,
    `Provide it as ${examples} or pass a JSON object.`,
    contract.signature ? `Input signature: ${contract.signature}` : "",
    contract.jsdoc ? `Input docstring:\n${contract.jsdoc}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function findDefaultWorkflow(sourceFile: ts.SourceFile): { node: ts.Node; parameters: ts.NodeArray<ts.ParameterDeclaration> } | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportDefault(statement)) {
      return { node: statement, parameters: statement.parameters };
    }
    if (ts.isExportAssignment(statement)) {
      const expression = statement.expression;
      if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression))
        return { node: statement, parameters: expression.parameters };
    }
  }
  return undefined;
}

function hasExportDefault(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(
    modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
}

function extractNodeJsDoc(source: string, sourceFile: ts.SourceFile, node: ts.Node): string | undefined {
  const leading = source.slice(node.getFullStart(), node.getStart(sourceFile));
  const match = /\/\*\*([\s\S]*?)\*\//.exec(leading);
  if (!match) return undefined;
  const cleaned = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd())
    .join("\n")
    .trim();
  return cleaned || undefined;
}

function extractLeadingJsDoc(source: string): string | undefined {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (!match) return undefined;
  const cleaned = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trimEnd())
    .join("\n")
    .trim();
  return cleaned || undefined;
}

function workflowSignature(sourceFile: ts.SourceFile, parameters: ts.NodeArray<ts.ParameterDeclaration>): string | undefined {
  if (parameters.length === 0) return undefined;
  return `workflow(${parameters.map((parameter) => parameter.getText(sourceFile)).join(", ")})`;
}

function inputFieldsFromParameters(parameters: ts.NodeArray<ts.ParameterDeclaration>): { required: string[]; optional: string[] } {
  if (parameters.length === 0) return { required: [], optional: [] };
  const first = parameters[0];
  if (!ts.isObjectBindingPattern(first.name)) return { required: [], optional: [] };
  const required: string[] = [];
  const optional: string[] = [];
  for (const element of first.name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const name = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
    if (element.initializer) optional.push(name);
    else required.push(name);
  }
  return { required, optional };
}

function inputFieldsFromJsDoc(jsdoc: string): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  for (const match of jsdoc.matchAll(/@param\s+\{[^}]+}\s+(\[[^\]]+]|[A-Za-z_][\w]*\.[A-Za-z_][\w.-]*\??)/g)) {
    const token = match[1];
    if (token.startsWith("[")) {
      const field = cleanJsDocField(token.slice(1, -1).split("=")[0]);
      if (field) optional.push(field);
      continue;
    }
    const field = cleanJsDocField(token.replace(/\?$/, ""));
    if (field) (token.endsWith("?") ? optional : required).push(field);
  }
  return { required, optional };
}

function cleanJsDocField(value: string): string | undefined {
  const trimmed = value.trim();
  const dot = trimmed.indexOf(".");
  if (dot < 0) return undefined;
  const field = trimmed.slice(dot + 1);
  return /^[A-Za-z_][\w.-]*$/.test(field) ? field : undefined;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
