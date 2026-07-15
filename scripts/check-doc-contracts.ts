#!/usr/bin/env tsx
/** Checks repository documentation maps and staged behavior/documentation synchronization. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const documentationRoots = ["agent_docs", "docs", "extensions", "scripts", "src"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const docExtensions = new Set([".md", ".mdx"]);
const docPaths = ["README.md", "AGENTS.md", "docs/", "agent_docs/"];
const behaviorPathPatterns = [/^extensions\//, /^src\//, /^scripts\//];

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

/** Checks every maintained source or prose directory for its concise local map. */
export function checkDocumentationContracts(options: DocumentationCheckOptions): DocumentationCheckResult {
  const stagedFiles = options.staged ? normalizePaths(options.stagedFiles ?? stagedFilePaths(options.cwd)) : [];
  const issues = requiredDocumentationDirectories(options.cwd).map((filePath) => ({
    filePath,
    line: 1,
    message: "directory with maintained source or docs must contain a concise AGENTS.md map",
  }));
  if (options.staged) issues.push(...docsSynchronizationIssues(stagedFiles));
  return { issues };
}

/** Returns maintained directories that lack a local AGENTS.md ownership map. */
export function requiredDocumentationDirectories(cwd: string): string[] {
  return documentationRoots
    .flatMap((root) => walkDirectories(path.join(cwd, root), cwd))
    .filter((directory) => containsMaintainedFile(path.join(cwd, directory)))
    .filter((directory) => !existsSync(path.join(cwd, directory, "AGENTS.md")))
    .sort(comparePaths);
}

/** Requires a documentation update beside staged behavior-surface changes. */
export function docsSynchronizationIssues(stagedFiles: string[]): DocumentationIssue[] {
  const normalized = normalizePaths(stagedFiles);
  if (!normalized.some(isBehaviorPath) || normalized.some(isDocumentationPath)) return [];
  return [
    {
      filePath: "<staged files>",
      line: 1,
      message: "behavior-surface changes must stage a documentation update in README.md, AGENTS.md, docs/**, or agent_docs/**",
    },
  ];
}

function containsMaintainedFile(directory: string): boolean {
  return readdirSync(directory).some((entry) => {
    if (entry === "AGENTS.md") return false;
    const absolutePath = path.join(directory, entry);
    if (!statSync(absolutePath).isFile()) return false;
    const extension = path.extname(entry);
    return sourceExtensions.has(extension) || docExtensions.has(extension);
  });
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

function walkDirectories(root: string, cwd: string): string[] {
  if (!existsSync(root)) return [];
  return [
    normalizePath(path.relative(cwd, root)),
    ...readdirSync(root).flatMap((entry) => {
      const absolutePath = path.join(root, entry);
      return statSync(absolutePath).isDirectory() ? walkDirectories(absolutePath, cwd) : [];
    }),
  ];
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
  const result = checkDocumentationContracts({ cwd: process.cwd(), ...parseArgs(process.argv.slice(2)) });
  if (result.issues.length === 0) return;
  console.error("Documentation contract check failed:");
  for (const issue of result.issues) console.error(`${issue.filePath}:${String(issue.line)} ${issue.message}`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
