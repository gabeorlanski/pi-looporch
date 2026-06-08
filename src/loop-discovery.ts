import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isValidLoopName, normalizeLoopName } from "./loop-runtime.ts";

export interface LoopReference {
  name: string;
  dir: string;
}

interface LooporchSettings {
  loopDirs: string[];
}

export async function loopRootsForProject(cwd: string): Promise<string[]> {
  const projectRoot = path.resolve(cwd);
  const localRoot = path.join(projectRoot, ".pi", "loops");
  const settings = await readLooporchSettings(projectRoot);
  const configuredRoots = settings.loopDirs.map((loopDir) => path.resolve(projectRoot, loopDir));
  return [...new Set([localRoot, ...configuredRoots])];
}

export async function discoverLoops(cwd: string): Promise<LoopReference[]> {
  const roots = await loopRootsForProject(cwd);
  const byName = new Map<string, LoopReference>();
  for (const root of roots) {
    for (const loop of await discoverLoopsInRoot(root)) {
      if (!byName.has(loop.name)) byName.set(loop.name, loop);
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readLooporchSettings(projectRoot: string): Promise<LooporchSettings> {
  const settingsPath = path.join(projectRoot, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return { loopDirs: [] };
  const raw = await readFile(settingsPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const looporch = typeof parsed === "object" && parsed !== null ? (parsed as { looporch?: unknown }).looporch : undefined;
  if (looporch === undefined) return { loopDirs: [] };
  if (!isLooporchSettings(looporch)) throw new Error(".pi/settings.json looporch config must contain { \"loopDirs\": [\"path\"] }");
  return looporch;
}

function isLooporchSettings(value: unknown): value is LooporchSettings {
  if (typeof value !== "object" || value === null) return false;
  const loopDirs = (value as { loopDirs?: unknown }).loopDirs;
  return Array.isArray(loopDirs) && loopDirs.every((item) => typeof item === "string" && item.trim().length > 0);
}

async function discoverLoopsInRoot(root: string): Promise<LoopReference[]> {
  const absoluteRoot = path.resolve(root);
  const rootName = path.basename(absoluteRoot);
  if (hasLoopMarkdown(absoluteRoot)) {
    return isValidLoopName(rootName) ? [{ name: normalizeLoopName(rootName), dir: absoluteRoot }] : [];
  }

  const entries = await readDirectoryEntries(absoluteRoot);
  const loops: LoopReference[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidLoopName(entry.name)) continue;
    const name = normalizeLoopName(entry.name);
    const dir = path.join(absoluteRoot, name);
    if (hasLoopMarkdown(dir)) loops.push({ name, dir });
  }
  return loops;
}

function hasLoopMarkdown(loopDir: string): boolean {
  return existsSync(path.join(loopDir, "LOOP.md"));
}

async function readDirectoryEntries(directory: string) {
  if (!existsSync(directory)) return [];
  return readdir(directory, { withFileTypes: true, encoding: "utf8" });
}
