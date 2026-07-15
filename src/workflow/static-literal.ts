/** Provides static literal behavior. */
import * as ts from "typescript";

/** Reads a JSON-like AST literal without evaluating workflow code. */
export function readStaticJsonLiteral(node: ts.Expression, sourceFile: ts.SourceFile, path: string): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element, index) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) throw new Error(`${path} must be static JSON-like literals`);
      return readStaticJsonLiteral(element, sourceFile, `${path}[${String(index)}]`);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property)) throw new Error(`${path} can only contain static property assignments`);
        const key = staticPropertyName(property.name, sourceFile, path);
        return [key, readStaticJsonLiteral(property.initializer, sourceFile, `${path}.${key}`)];
      }),
    );
  }
  throw new Error(`${path} must be static JSON-like literals`);
}

/** Provides the isStaticJsonLiteral function contract. */
export function isStaticJsonLiteral(node: ts.Expression, sourceFile: ts.SourceFile): boolean {
  try {
    readStaticJsonLiteral(node, sourceFile, "value");
    return true;
  } catch {
    return false;
  }
}

/** Provides the staticPropertyName function contract. */
export function staticPropertyName(name: ts.PropertyName, sourceFile: ts.SourceFile, path: string): string {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`${path} cannot use computed property ${name.getText(sourceFile)}`);
}
