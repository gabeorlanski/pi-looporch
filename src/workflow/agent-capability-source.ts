import * as ts from "typescript";
import type { CapabilitySelection } from "./settings.ts";
import { analyzeWorkflowPrimitiveCalls } from "./primitive-calls.ts";

const AGENT_PRIMITIVES = ["agent", "coerce", "mapreduce", "verifier"] as const;

export type AgentPrimitiveName = (typeof AGENT_PRIMITIVES)[number];
export type CapabilityName = "extensions" | "tools";

export type CapabilityValue =
  | { kind: "all"; node: ts.Node; entries: [] }
  | { kind: "list"; values: string[]; node: ts.Node; entries: { value: string; node: ts.Node }[] }
  | { kind: "invalid"; node: ts.Node; entries: [] };

export interface CapabilityUse {
  primitive: AgentPrimitiveName;
  extensions: CapabilityValue;
  tools: CapabilityValue;
}

export interface CapabilityDiagnostic {
  node: ts.Node;
  primitive: AgentPrimitiveName;
  capability: CapabilityName | "invocation";
  index?: number;
  value?: unknown;
  reason: string;
}

interface TopLevelConstant {
  declaration: ts.VariableDeclaration;
  initializer: ts.Expression;
}

interface CapabilityConstantContext {
  checker: ts.TypeChecker;
  constants: ReadonlyMap<ts.Symbol, TopLevelConstant>;
  safeReferences: ReadonlySet<ts.Identifier>;
  sourceFile: ts.SourceFile;
}

/** Finds child-agent primitive calls and statically resolves their capability selections. */
export function collectWorkflowAgentCapabilityUses(
  sourceFile: ts.SourceFile,
  defaultExtensions: CapabilitySelection,
  defaultTools: CapabilitySelection,
  diagnostics: CapabilityDiagnostic[],
): CapabilityUse[] {
  const analysis = analyzeWorkflowPrimitiveCalls(sourceFile, AGENT_PRIMITIVES);
  const constants: CapabilityConstantContext = {
    checker: analysis.checker,
    constants: topLevelConstants(sourceFile, analysis.checker),
    safeReferences: capabilityReferenceIdentifiers(analysis.calls),
    sourceFile,
  };
  diagnostics.push(
    ...analysis.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      capability: "invocation" as const,
    })),
  );
  return analysis.calls.map(({ primitive, call }) => {
    const optionsNode = call.arguments.at(primitive === "agent" ? 1 : 0);
    return {
      primitive,
      extensions: readCapabilityValue(primitive, "extensions", optionsNode, call, defaultExtensions, constants, diagnostics),
      tools: readCapabilityValue(primitive, "tools", optionsNode, call, defaultTools, constants, diagnostics),
    };
  });
}

function readCapabilityValue(
  primitive: AgentPrimitiveName,
  capability: CapabilityName,
  optionsNode: ts.Expression | undefined,
  callNode: ts.CallExpression,
  defaultSelection: CapabilitySelection,
  constants: CapabilityConstantContext,
  diagnostics: CapabilityDiagnostic[],
): CapabilityValue {
  if (optionsNode === undefined) return defaultCapabilityValue(defaultSelection, callNode);
  if (!ts.isObjectLiteralExpression(optionsNode)) {
    diagnostics.push({
      node: optionsNode,
      primitive,
      capability,
      reason: "Agent primitive options must be an object literal so capability lists can be validated.",
    });
    return { kind: "invalid", node: optionsNode, entries: [] };
  }
  const spread = optionsNode.properties.find(ts.isSpreadAssignment);
  if (spread) {
    diagnostics.push({
      node: spread,
      primitive,
      capability,
      reason: "Agent primitive options cannot use spreads because capability selections must be statically verifiable.",
    });
    return { kind: "invalid", node: spread, entries: [] };
  }
  const properties = optionsNode.properties.filter((candidate) => propertyName(candidate) === capability);
  if (properties.length === 0) return defaultCapabilityValue(defaultSelection, optionsNode);
  if (properties.length > 1) {
    diagnostics.push({
      node: properties[1] ?? optionsNode,
      primitive,
      capability,
      reason: "Capability must be specified at most once.",
    });
    return { kind: "invalid", node: properties[1] ?? optionsNode, entries: [] };
  }
  const property = properties[0];
  const expression = capabilityPropertyExpression(property);
  if (!expression) {
    diagnostics.push({
      node: property,
      primitive,
      capability,
      reason: "Capability selection must be an inline array or a statically resolvable top-level const array.",
    });
    return { kind: "invalid", node: property, entries: [] };
  }
  return readCapabilityArray(primitive, capability, expression, constants, diagnostics);
}

function defaultCapabilityValue(selection: CapabilitySelection, node: ts.Node): CapabilityValue {
  return selection === "all"
    ? { kind: "all", node, entries: [] }
    : { kind: "list", values: [...selection], node, entries: selection.map((value) => ({ value, node })) };
}

function capabilityPropertyExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
}

function readCapabilityArray(
  primitive: AgentPrimitiveName,
  capability: CapabilityName,
  expression: ts.Expression,
  constants: CapabilityConstantContext,
  diagnostics: CapabilityDiagnostic[],
): CapabilityValue {
  if (ts.isIdentifier(expression)) {
    const symbol = constants.checker.getSymbolAtLocation(expression);
    if (!symbol) {
      diagnostics.push({
        node: expression,
        primitive,
        capability,
        value: expression.text,
        reason: "Capability selection must be an inline array or a statically resolvable top-level const array.",
      });
      return { kind: "invalid", node: expression, entries: [] };
    }
    const constant = constants.constants.get(symbol);
    if (!constant) {
      diagnostics.push({
        node: expression,
        primitive,
        capability,
        value: expression.text,
        reason: "Capability selection must be an inline array or a statically resolvable top-level const array.",
      });
      return { kind: "invalid", node: expression, entries: [] };
    }
    if (ts.isIdentifier(unwrapParentheses(constant.initializer))) {
      diagnostics.push({
        node: expression,
        primitive,
        capability,
        value: expression.text,
        reason: "Capability const arrays cannot be mutated or aliased.",
      });
      return { kind: "invalid", node: expression, entries: [] };
    }
    if (constantHasUnsafeReferences(symbol, constant, constants)) {
      diagnostics.push({
        node: expression,
        primitive,
        capability,
        value: expression.text,
        reason: "Capability const arrays cannot be mutated or used outside capability fields.",
      });
      return { kind: "invalid", node: expression, entries: [] };
    }
    return readCapabilityArray(primitive, capability, constant.initializer, constants, diagnostics);
  }
  if (!ts.isArrayLiteralExpression(expression)) {
    const isDynamic =
      !ts.isStringLiteralLike(expression) &&
      !ts.isNumericLiteral(expression) &&
      expression.kind !== ts.SyntaxKind.TrueKeyword &&
      expression.kind !== ts.SyntaxKind.FalseKeyword &&
      expression.kind !== ts.SyntaxKind.NullKeyword &&
      !ts.isObjectLiteralExpression(expression);
    diagnostics.push({
      node: expression,
      primitive,
      capability,
      value: expression.getText(),
      reason: isDynamic
        ? "Capability selection must be an inline array or a statically resolvable top-level const array."
        : "Capability selection must be an array of unique, non-empty strings.",
    });
    return { kind: "invalid", node: expression, entries: [] };
  }
  const diagnosticsBefore = diagnostics.length;
  const entries: { value: string; node: ts.Node }[] = [];
  const seenValues = new Set<string>();
  expression.elements.forEach((element, index) => {
    if (!ts.isStringLiteralLike(element) || !element.text.trim()) {
      diagnostics.push({
        node: element,
        primitive,
        capability,
        index,
        value: element.getText(),
        reason: "Capability entries must be non-empty strings.",
      });
      return;
    }
    const value = element.text.trim();
    if (seenValues.has(value)) {
      diagnostics.push({ node: element, primitive, capability, index, value, reason: "Duplicate capability entry." });
      return;
    }
    seenValues.add(value);
    entries.push({ value, node: element });
  });
  return diagnostics.length === diagnosticsBefore
    ? { kind: "list", values: entries.map((entry) => entry.value), node: expression, entries }
    : { kind: "invalid", node: expression, entries: [] };
}

function topLevelConstants(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Map<ts.Symbol, TopLevelConstant> {
  const constants = new Map<ts.Symbol, TopLevelConstant>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const symbol = checker.getSymbolAtLocation(declaration.name);
      if (symbol) constants.set(symbol, { declaration, initializer: declaration.initializer });
    }
  }
  return constants;
}

function capabilityReferenceIdentifiers(calls: readonly { primitive: AgentPrimitiveName; call: ts.CallExpression }[]): Set<ts.Identifier> {
  const references = new Set<ts.Identifier>();
  for (const { call, primitive } of calls) {
    const options = call.arguments.at(primitive === "agent" ? 1 : 0);
    if (!options || !ts.isObjectLiteralExpression(options)) continue;
    for (const property of options.properties) {
      if (propertyName(property) !== "extensions" && propertyName(property) !== "tools") continue;
      const expression = ts.isPropertyAssignment(property)
        ? unwrapParentheses(property.initializer)
        : ts.isShorthandPropertyAssignment(property)
          ? property.name
          : undefined;
      if (expression && ts.isIdentifier(expression)) references.add(expression);
    }
  }
  return references;
}

function constantHasUnsafeReferences(symbol: ts.Symbol, constant: TopLevelConstant, context: CapabilityConstantContext): boolean {
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (
      ts.isIdentifier(node) &&
      node !== constant.declaration.name &&
      context.checker.getSymbolAtLocation(node) === symbol &&
      !context.safeReferences.has(node)
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return unsafe;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) {
    return property.name.text;
  }
  if (ts.isComputedPropertyName(property.name) && ts.isStringLiteralLike(property.name.expression)) {
    return property.name.expression.text;
  }
  return undefined;
}
