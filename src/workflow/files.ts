import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkflowReadPath } from "./paths.ts";

export function readWorkflowText(cwd: string, workflowDir: string, filePath: string): string {
  return readFileSync(resolveWorkflowReadPath(cwd, workflowDir, filePath), "utf8");
}

export function readWorkflowJson(cwd: string, workflowDir: string, filePath: string): unknown {
  return JSON.parse(readWorkflowText(cwd, workflowDir, filePath)) as unknown;
}

export function writeWorkflowText(cwd: string, workflowDir: string, filePath: string, content: string): string {
  if (typeof content !== "string") throw new Error("writeText content must be a string");
  const outputPath = resolveWorkflowReadPath(cwd, workflowDir, filePath);
  writeTextFileAtomicSync(outputPath, content);
  return outputPath;
}

export function writeWorkflowJson(cwd: string, workflowDir: string, filePath: string, value: unknown): string {
  return writeWorkflowText(cwd, workflowDir, filePath, jsonFileText(value));
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextFileAtomic(filePath, jsonFileText(value));
}

export async function writeTextFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryFilePath(filePath);
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

function writeTextFileAtomicSync(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = temporaryFilePath(filePath);
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, filePath);
}

function jsonFileText(value: unknown): string {
  return `${JSON.stringify(value ?? null, null, 2)}\n`;
}

function temporaryFilePath(filePath: string): string {
  return `${filePath}.${String(process.pid)}.${randomUUID()}.tmp`;
}
