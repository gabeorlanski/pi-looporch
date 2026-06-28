#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const productionRoots = ["extensions", "src"];
const productionExtensions = new Set([".ts", ".tsx"]);
const docPaths = ["README.md", "AGENTS.md", "docs/", "agent_docs/"];
const docstringPathPatterns = [
  /^extensions\/workflow\.ts$/,
  /^src\/input\.ts$/,
  /^src\/request\.ts$/,
  /^src\/runtime-types\.ts$/,
  /^src\/tools\.ts$/,
];
const behaviorPathPatterns = [
  /^extensions\//,
  /^src\/(?:authoring-guide|background-runs|discovery|input|pi-agent|request|runtime-types|tools|workflow-(?:outputs|paths|sandbox|settings))\.ts$/,
  /^src\/runtime\//,
  /^src\/prompts\//,
];
const excludedDocstringPathPatterns = [/^src\/runtime\.ts$/, /^src\/runtime\/primitives\//, /^src\/display\//, /^tests\//, /^scripts\//];

export interface DocumentationIssue {
  filePath: string;
  line: number;
  message: string;
}

export interface DocumentationCheckOptions {
  cwd: string;
  staged: boolean;
  stagedFiles?: string[];
}

export interface DocumentationCheckResult {
  issues: DocumentationIssue[];
}

export function checkDocumentationContracts(options: DocumentationCheckOptions): DocumentationCheckResult {
  const stagedFiles = options.staged ? normalizePaths(options.stagedFiles ?? stagedFilePaths(options.cwd)) : [];
  const files = options.staged ? stagedFiles.filter((filePath) => shouldCheckDocstrings(filePath)) : allDocstringFiles(options.cwd);
  const issues = files.flatMap((filePath) => exportedDocstringIssues(options.cwd, filePath));
  if (options.staged) issues.push(...docsSynchronizationIssues(stagedFiles));
  return { issues };
}

export function shouldCheckDocstrings(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!productionExtensions.has(path.extname(normalized))) return false;
  if (!productionRoots.some((root) => normalized.startsWith(`${root}/`))) return false;
  if (!docstringPathPatterns.some((pattern) => pattern.test(normalized))) return false;
  return !excludedDocstringPathPatterns.some((pattern) => pattern.test(normalized));
}

export function docsSynchronizationIssues(stagedFiles: string[]): DocumentationIssue[] {
  const normalized = normalizePaths(stagedFiles);
  if (!normalized.some(isBehaviorPath)) return [];
  if (normalized.some(isDocumentationPath)) return [];
  return [
    {
      filePath: "<staged files>",
      line: 1,
      message: "behavior-surface changes must stage a documentation update in README.md, AGENTS.md, docs/**, or agent_docs/**",
    },
  ];
}

function allDocstringFiles(cwd: string): string[] {
  return productionRoots
    .flatMap((root) => walk(path.join(cwd, root), cwd))
    .filter(shouldCheckDocstrings)
    .sort(comparePaths);
}

function exportedDocstringIssues(cwd: string, filePath: string): DocumentationIssue[] {
  const absolutePath = path.join(cwd, filePath);
  if (!existsSync(absolutePath)) return [];
  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const issues: DocumentationIssue[] = [];
  const visit = (node: ts.Node): void => {
    if (isDocumentableExport(node) && !hasLeadingJsDoc(sourceText, node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      issues.push({
        filePath,
        line: position.line + 1,
        message: `exported ${exportedDeclarationName(node)} is missing a leading JSDoc contract`,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function isDocumentableExport(node: ts.Node): node is ts.DeclarationStatement {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    return hasExportModifier(node);
  }
  if (ts.isVariableStatement(node)) return hasExportModifier(node) && !isExemptExportedVariable(node);
  return false;
}

function isExemptExportedVariable(node: ts.VariableStatement): boolean {
  return node.declarationList.declarations.every((declaration) => {
    const name = declaration.name.getText();
    return name === name.toUpperCase() || name.endsWith("Primitive");
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasLeadingJsDoc(sourceText: string, node: ts.Node): boolean {
  const ranges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const lastComment = ranges.at(-1);
  if (!lastComment) return false;
  const comment = sourceText.slice(lastComment.pos, lastComment.end);
  if (!comment.startsWith("/**")) return false;
  return sourceText.slice(lastComment.end, node.getStart()).trim().length === 0;
}

function exportedDeclarationName(node: ts.DeclarationStatement): string {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((declaration) => declaration.name.getText()).join(", ");
  }
  const name = "name" in node && node.name ? node.name.getText() : "default export";
  if (ts.isFunctionDeclaration(node)) return `function ${name}`;
  if (ts.isClassDeclaration(node)) return `class ${name}`;
  if (ts.isInterfaceDeclaration(node)) return `interface ${name}`;
  if (ts.isTypeAliasDeclaration(node)) return `type ${name}`;
  return name;
}

function isBehaviorPath(filePath: string): boolean {
  return behaviorPathPatterns.some((pattern) => pattern.test(filePath));
}

function isDocumentationPath(filePath: string): boolean {
  return docPaths.some((docPath) => (docPath.endsWith("/") ? filePath.startsWith(docPath) : filePath === docPath));
}

function stagedFilePaths(cwd: string): string[] {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { cwd, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function walk(root: string, cwd: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const absolutePath = path.join(root, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) return walk(absolutePath, cwd);
    if (!stats.isFile()) return [];
    return [normalizePath(path.relative(cwd, absolutePath))];
  });
}

function normalizePaths(filePaths: string[]): string[] {
  return filePaths.map(normalizePath).sort(comparePaths);
}

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}

function parseArgs(argv: string[]): { staged: boolean } {
  return { staged: argv.includes("--staged") };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const result = checkDocumentationContracts({ cwd: process.cwd(), staged: args.staged });
  if (result.issues.length === 0) return;
  console.error("Documentation contract check failed:");
  for (const issue of result.issues) console.error(`${issue.filePath}:${String(issue.line)} ${issue.message}`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
