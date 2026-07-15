/** Provides primitive calls behavior. */
import * as ts from "typescript";
import { createWorkflowTypeChecker } from "./static-symbols.ts";

/** One workflow primitive call whose lexical target resolves to a sandbox global or safe const alias. */
export interface WorkflowPrimitiveCall<TName extends string> {
  primitive: TName;
  call: ts.CallExpression;
}

/** One primitive reference whose invocation cannot be proven statically. */
export interface WorkflowPrimitiveReferenceDiagnostic<TName extends string> {
  primitive: TName;
  node: ts.Node;
  reason: string;
}

/** Scope-aware primitive calls and unsupported references found in one workflow source file. */
export interface WorkflowPrimitiveCallAnalysis<TName extends string> {
  calls: WorkflowPrimitiveCall<TName>[];
  checker: ts.TypeChecker;
  diagnostics: WorkflowPrimitiveReferenceDiagnostic<TName>[];
}

/** Resolves direct, parenthesized, and const-aliased calls to injected workflow primitives. */
export function analyzeWorkflowPrimitiveCalls<TName extends string>(
  sourceFile: ts.SourceFile,
  primitiveNames: readonly TName[],
): WorkflowPrimitiveCallAnalysis<TName> {
  const checker = createWorkflowTypeChecker(sourceFile);
  const names = new Set<string>(primitiveNames);
  const aliases = new Map<ts.Symbol, TName>();
  const aliasDeclarations = new Set<ts.Identifier>();
  const aliasInitializers = new Set<ts.Identifier>();
  const declarations: ts.VariableDeclaration[] = [];
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      declarations.push(node);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const symbol = checker.getSymbolAtLocation(declaration.name);
      if (!symbol || aliases.has(symbol) || !declaration.initializer) continue;
      const initializer = unwrapParentheses(declaration.initializer);
      if (!ts.isIdentifier(initializer)) continue;
      const primitive = resolvePrimitiveIdentifier(initializer, checker, names, aliases);
      if (!primitive) continue;
      aliases.set(symbol, primitive);
      aliasDeclarations.add(declaration.name);
      aliasInitializers.add(initializer);
      changed = true;
    }
  }

  const calls: WorkflowPrimitiveCall<TName>[] = [];
  const callTargets = new Set<ts.Identifier>();
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expression = unwrapParentheses(node.expression);
    if (!ts.isIdentifier(expression)) return;
    const primitive = resolvePrimitiveIdentifier(expression, checker, names, aliases);
    if (!primitive) return;
    calls.push({ primitive, call: node });
    callTargets.add(expression);
  });

  const diagnostics: WorkflowPrimitiveReferenceDiagnostic<TName>[] = [];
  const diagnosedNodes = new Set<ts.Node>();
  visit(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || isNonReferenceIdentifier(node)) return;
    const primitive = resolvePrimitiveIdentifier(node, checker, names, aliases);
    if (!primitive || aliasDeclarations.has(node) || aliasInitializers.has(node) || callTargets.has(node)) return;
    const target = invocationProperty(node) ?? node;
    if (diagnosedNodes.has(target)) return;
    diagnosedNodes.add(target);
    diagnostics.push({
      primitive,
      node: target,
      reason:
        "Primitive references must be invoked directly, through parentheses, or through a const alias used only as a direct call target.",
    });
  });
  return { calls, checker, diagnostics };
}

function resolvePrimitiveIdentifier<TName extends string>(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  names: ReadonlySet<string>,
  aliases: ReadonlyMap<ts.Symbol, TName>,
): TName | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol) return aliases.get(symbol);
  return names.has(identifier.text) ? (identifier.text as TName) : undefined;
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function invocationProperty(identifier: ts.Identifier): ts.PropertyAccessExpression | undefined {
  let expression: ts.Expression = identifier;
  while (ts.isParenthesizedExpression(expression.parent) && expression.parent.expression === expression) expression = expression.parent;
  const property = expression.parent;
  return ts.isPropertyAccessExpression(property) && property.expression === expression ? property : undefined;
}

function isNonReferenceIdentifier(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return true;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === identifier
  )
    return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  return false;
}

function visit(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => visit(child, visitor));
}
