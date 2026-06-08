import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface LoopAgentOptions {
  label?: string;
  reasoning?: ReasoningLevel;
  model?: string;
  taskFile?: string;
  signal?: AbortSignal;
}

export interface LoopAgentProgress {
  statusMessage?: string;
  toolUseCount?: number;
  activeToolUseCount?: number;
  filesTouched?: string[];
  tokenCount?: number;
}

export type LoopAgent = (prompt: string, options: LoopAgentOptions, reportProgress: (progress: LoopAgentProgress) => void) => Promise<unknown>;

export type LoopAgentStatus = "running" | "done" | "error";

export interface LoopAgentSnapshot {
  id: number;
  label: string;
  prompt: string;
  options: LoopAgentOptions;
  status: LoopAgentStatus;
  resultPreview?: string;
  error?: string;
  statusMessage?: string;
  toolUseCount: number;
  activeToolUseCount: number;
  filesTouched: string[];
  tokenCount: number;
}

export interface LoopSnapshot {
  loopName: string;
  plan: string;
  phases: string[];
  currentPhase?: string;
  logs: string[];
  agents: LoopAgentSnapshot[];
  agentCount: number;
  runningCount: number;
  doneCount: number;
  errorCount: number;
  estimatedTokens: number;
  result?: unknown;
}

export interface LoopContext {
  input: unknown;
  loopDir: string;
  loopName: string;
  loopMarkdown: string;
  signal?: AbortSignal;
  agent(prompt: string, options?: LoopAgentOptions): Promise<unknown>;
  phase(title: string): void;
  log(message: string): void;
  resolveLoopPath(relativePath: string): string;
  readLoopFile(relativePath: string): string;
}

export interface RunLoopOptions {
  cwd: string;
  loopName: string;
  input: unknown;
  agent: LoopAgent;
  loopRoots?: string[];
  signal?: AbortSignal;
  onSnapshot?: (snapshot: LoopSnapshot) => void;
}

export interface LoopRunResult {
  loopName: string;
  loopDir: string;
  loopMarkdown: string;
  result: unknown;
  snapshot: LoopSnapshot;
}

type LoopFunction = (ctx: LoopContext) => Promise<unknown> | unknown;

export async function runLoopFromDirectory(options: RunLoopOptions): Promise<LoopRunResult> {
  const loopName = normalizeLoopName(options.loopName);
  const loopDir = await resolveLoopDirectory(options.cwd, loopName, options.loopRoots);
  const loopMarkdown = await readFile(path.join(loopDir, "LOOP.md"), "utf8");
  const snapshot = createSnapshot(loopName, loopMarkdown);
  const emitSnapshot = () => options.onSnapshot?.(cloneSnapshot(snapshot));

  const ctx: LoopContext = {
    input: options.input,
    loopDir,
    loopName,
    loopMarkdown,
    signal: options.signal,
    async agent(prompt, agentOptions = {}) {
      throwIfAborted(options.signal);
      const id = snapshot.agents.length + 1;
      const normalizedOptions = options.signal ? { ...agentOptions, signal: options.signal } : { ...agentOptions };
      const label = normalizedOptions.label ?? `agent ${id}`;
      const agentSnapshot: LoopAgentSnapshot = {
        id,
        label,
        prompt,
        options: normalizedOptions,
        status: "running",
        statusMessage: "starting",
        toolUseCount: 0,
        activeToolUseCount: 0,
        filesTouched: [],
        tokenCount: 0,
      };
      snapshot.agents.push(agentSnapshot);
      snapshot.estimatedTokens += estimateTokens(prompt);
      recompute(snapshot);
      emitSnapshot();
      try {
        const result = await options.agent(prompt, normalizedOptions, (progress) => {
          applyAgentProgress(agentSnapshot, progress);
          recompute(snapshot);
          emitSnapshot();
        });
        throwIfAborted(options.signal);
        agentSnapshot.status = "done";
        agentSnapshot.statusMessage = "complete";
        agentSnapshot.resultPreview = preview(result);
        snapshot.estimatedTokens += estimateTokens(result);
        recompute(snapshot);
        emitSnapshot();
        return result;
      } catch (error) {
        agentSnapshot.status = "error";
        agentSnapshot.statusMessage = "failed";
        agentSnapshot.error = errorMessage(error);
        recompute(snapshot);
        emitSnapshot();
        throw error;
      }
    },
    phase(title) {
      const phaseTitle = requireNonEmptyString(title, "phase title");
      snapshot.currentPhase = phaseTitle;
      if (!snapshot.phases.includes(phaseTitle)) snapshot.phases.push(phaseTitle);
      emitSnapshot();
    },
    log(message) {
      snapshot.logs.push(String(message));
      emitSnapshot();
    },
    resolveLoopPath(relativePath) {
      return resolveInsideLoop(loopDir, relativePath);
    },
    readLoopFile(relativePath) {
      return readFileSync(resolveInsideLoop(loopDir, relativePath), "utf8");
    },
  };

  emitSnapshot();
  const loopFunction = existsSync(path.join(loopDir, "loop.js"))
    ? await loadLoopFunctionFromFile(path.join(loopDir, "loop.js"))
    : await generateLoopFunction(ctx, loopDir);
  const result = await loopFunction(ctx);
  snapshot.result = result;
  recompute(snapshot);
  emitSnapshot();

  return { loopName, loopDir, loopMarkdown, result, snapshot: cloneSnapshot(snapshot) };
}

export function isValidLoopName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

export function normalizeLoopName(loopName: string): string {
  const normalized = requireNonEmptyString(loopName, "loop name");
  if (!isValidLoopName(normalized)) throw new Error(`Invalid loop name: ${loopName}`);
  return normalized;
}

export async function resolveLoopDirectory(cwd: string, loopName: string, loopRoots: string[] | undefined): Promise<string> {
  const roots = loopRoots?.length ? loopRoots : [path.resolve(cwd, ".pi", "loops")];
  for (const root of roots) {
    const absoluteRoot = path.resolve(root);
    if (path.basename(absoluteRoot) === loopName && existsSync(path.join(absoluteRoot, "LOOP.md"))) {
      return absoluteRoot;
    }
    const child = path.join(absoluteRoot, loopName);
    if (existsSync(path.join(child, "LOOP.md"))) return child;
  }
  throw new Error(`Loop '${loopName}' not found`);
}

export function resolveInsideLoop(loopDir: string, relativePath: string): string {
  const rawPath = requireNonEmptyString(relativePath, "loop file path").replace(/^@/, "");
  const absolutePath = path.resolve(loopDir, rawPath);
  const relative = path.relative(loopDir, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Loop file escapes loop directory: ${relativePath}`);
  }
  return absolutePath;
}

function createSnapshot(loopName: string, loopMarkdown: string): LoopSnapshot {
  return {
    loopName,
    plan: firstMarkdownHeading(loopMarkdown) ?? loopName,
    phases: [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
    estimatedTokens: estimateTokens(loopMarkdown),
  };
}

async function generateLoopFunction(ctx: LoopContext, loopDir: string): Promise<LoopFunction> {
  ctx.phase("generate loop");
  const source = extractLoopSource(await ctx.agent(generationPrompt(ctx), { label: "generate loop.js", reasoning: "medium" }));
  const loopFunction = await loadLoopFunctionFromSource(source);
  await writeFile(path.join(loopDir, "loop.js"), `${source}\n`, "utf8");
  return loopFunction;
}

function generationPrompt(ctx: LoopContext): string {
  return [
    "No loop.js exists for this pi-looporch loop. Create the loop.js now.",
    "Return only JavaScript that exports `default async function loop(ctx) { ... }`.",
    "Use ctx.agent(prompt, options), ctx.phase(title), ctx.log(message), ctx.readLoopFile(path), and ctx.resolveLoopPath(path).",
    "The loop input is available as ctx.input.",
    "LOOP.md:",
    ctx.loopMarkdown,
    "Input JSON:",
    JSON.stringify(ctx.input, null, 2),
  ].join("\n\n");
}

function extractLoopSource(value: unknown): string {
  const raw = typeof value === "object" && value !== null && "source" in value ? (value as { source: unknown }).source : value;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Generated loop.js must be a non-empty string");
  const fenced = raw.match(/```(?:js|javascript)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced ?? raw).trim();
  if (!source.includes("export default")) throw new Error("Generated loop.js must export a default function");
  return source;
}

async function loadLoopFunctionFromFile(filePath: string): Promise<LoopFunction> {
  const href = `${pathToFileURL(filePath).href}?mtime=${Date.now()}`;
  return requireLoopFunction(await import(href));
}

async function loadLoopFunctionFromSource(source: string): Promise<LoopFunction> {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return requireLoopFunction(await import(`data:text/javascript;base64,${encoded}`));
}

function requireLoopFunction(moduleExports: unknown): LoopFunction {
  const candidate = (moduleExports as { default?: unknown }).default;
  if (typeof candidate !== "function") throw new Error("loop.js must export a default function");
  return candidate as LoopFunction;
}

function applyAgentProgress(agent: LoopAgentSnapshot, progress: LoopAgentProgress): void {
  if (progress.statusMessage !== undefined) agent.statusMessage = progress.statusMessage;
  if (progress.toolUseCount !== undefined) agent.toolUseCount = progress.toolUseCount;
  if (progress.activeToolUseCount !== undefined) agent.activeToolUseCount = progress.activeToolUseCount;
  if (progress.tokenCount !== undefined) agent.tokenCount = progress.tokenCount;
  if (progress.filesTouched !== undefined) agent.filesTouched = [...new Set(progress.filesTouched)];
}

function recompute(snapshot: LoopSnapshot): void {
  snapshot.agentCount = snapshot.agents.length;
  snapshot.runningCount = snapshot.agents.filter((agent) => agent.status === "running").length;
  snapshot.doneCount = snapshot.agents.filter((agent) => agent.status === "done").length;
  snapshot.errorCount = snapshot.agents.filter((agent) => agent.status === "error").length;
}

function cloneSnapshot(snapshot: LoopSnapshot): LoopSnapshot {
  return {
    ...snapshot,
    phases: [...snapshot.phases],
    logs: [...snapshot.logs],
    agents: snapshot.agents.map((agent) => ({ ...agent, options: { ...agent.options }, filesTouched: [...agent.filesTouched] })),
  };
}

function firstMarkdownHeading(markdown: string): string | undefined {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : undefined;
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function requireNonEmptyString(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must be non-empty`);
  return normalized;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Loop aborted");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
