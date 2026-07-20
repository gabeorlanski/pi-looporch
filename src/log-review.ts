/** Provides log review behavior. */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { formatTokenCount } from "./display/progress.ts";
import { parseSessionTokens } from "./session/usage.ts";
import { workflowAgentSessionLogParentDirectory } from "./session/logs.ts";

export interface WorkflowLogReviewOptions {
  cwd: string;
  target?: string;
  sessionsRoot?: string;
}

interface WorkflowLogAgentReview {
  id: number;
  label: string;
  phase?: string;
  model?: string;
  inputTokenCount: number;
  outputTokenCount: number;
  tokenCount: number;
  toolCallCount: number;
  toolCounts: Map<string, number>;
  bashCommands: string[];
}

interface WorkflowLogReview {
  logDir: string;
  workflowName: string;
  description?: string;
  agents: WorkflowLogAgentReview[];
}

/** Provides the workflowLogReviewMessage function contract. */
export async function workflowLogReviewMessage(options: WorkflowLogReviewOptions): Promise<string> {
  const logDir = await resolveWorkflowLogDirectory(options);
  const summary = readObject(await readFile(path.join(logDir, "workflow-summary.json"), "utf8"), "workflow-summary.json");
  const review = await analyzeWorkflowLogDirectory(logDir, summary);
  return renderWorkflowLogReview(options.cwd, review);
}

async function resolveWorkflowLogDirectory(options: WorkflowLogReviewOptions): Promise<string> {
  const target = options.target?.trim();
  if (!target || target === "latest") return latestWorkflowLogDirectory(options.cwd, options.sessionsRoot);
  const projectSessionRoot = workflowProjectSessionRoot(options.cwd, options.sessionsRoot);
  const expandedTarget = expandHomePath(target);
  const resolved = path.isAbsolute(expandedTarget) ? expandedTarget : path.resolve(options.cwd, expandedTarget);
  if (existsSync(path.join(resolved, "workflow-summary.json"))) return resolved;
  const namedRun = path.join(projectSessionRoot, target);
  if (existsSync(path.join(namedRun, "workflow-summary.json"))) return namedRun;
  if (expandedTarget.endsWith("workflow-summary.json")) {
    const summaryFile = path.isAbsolute(expandedTarget) ? expandedTarget : path.resolve(options.cwd, expandedTarget);
    if (existsSync(summaryFile)) return path.dirname(summaryFile);
  }
  throw new Error(`Workflow log review needs a session log directory containing workflow-summary.json. Tried '${target}'.`);
}

async function latestWorkflowLogDirectory(cwd: string, sessionsRoot: string | undefined): Promise<string> {
  const projectSessionRoot = workflowProjectSessionRoot(cwd, sessionsRoot);
  if (!existsSync(projectSessionRoot)) throw new Error("No workflow session logs found for this project.");
  const entries = await readdir(projectSessionRoot, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runDir = path.join(projectSessionRoot, entry.name);
        const summaryFile = path.join(runDir, "workflow-summary.json");
        if (!existsSync(summaryFile)) return undefined;
        const fileStat = await stat(summaryFile);
        return { runDir, modifiedAt: fileStat.mtimeMs };
      }),
  );
  const latest = candidates
    .filter((candidate): candidate is { runDir: string; modifiedAt: number } => candidate !== undefined)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .at(0);
  if (latest === undefined) throw new Error("No workflow-summary.json files found for this project.");
  return latest.runDir;
}

function workflowProjectSessionRoot(cwd: string, sessionsRoot = path.join(getAgentDir(), "sessions")): string {
  return path.dirname(workflowAgentSessionLogParentDirectory(cwd, "__placeholder__", sessionsRoot));
}

function expandHomePath(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
}

async function analyzeWorkflowLogDirectory(logDir: string, summary: Record<string, unknown>): Promise<WorkflowLogReview> {
  const agents = await Promise.all((Array.isArray(summary.agents) ? summary.agents : []).map((agent) => analyzeAgentLog(agent)));
  return {
    logDir,
    workflowName: stringValue(summary.workflowName) ?? "unknown",
    ...(stringValue(summary.description) ? { description: stringValue(summary.description) } : {}),
    agents,
  };
}

async function analyzeAgentLog(rawAgent: unknown): Promise<WorkflowLogAgentReview> {
  const agent = recordValue(rawAgent);
  const sessionDir = stringValue(agent.sessionDir);
  const sessionUsage = sessionDir ? parseSessionTokens(sessionDir) : null;
  const eventsFile = stringValue(agent.eventsFile);
  const sessionFile = stringValue(agent.sessionFile);
  const toolCounts = eventsFile ? await readToolCounts(eventsFile) : new Map<string, number>();
  const bashCommands = sessionFile ? await readBashCommands(sessionFile) : [];
  const toolCallCount = numberValue(agent.toolCallCount) ?? [...toolCounts.values()].reduce((total, count) => total + count, 0);
  const inputTokenCount = sessionUsage?.input ?? numberValue(agent.inputTokenCount) ?? 0;
  const outputTokenCount = sessionUsage?.output ?? numberValue(agent.outputTokenCount) ?? 0;
  return {
    id: numberValue(agent.id) ?? 0,
    label: stringValue(agent.label) ?? "agent",
    ...(stringValue(agent.phase) ? { phase: stringValue(agent.phase) } : {}),
    ...(stringValue(agent.model) ? { model: stringValue(agent.model) } : {}),
    inputTokenCount,
    outputTokenCount,
    tokenCount: sessionUsage?.total ?? inputTokenCount + outputTokenCount,
    toolCallCount,
    toolCounts,
    bashCommands,
  };
}

async function readToolCounts(eventsFile: string): Promise<Map<string, number>> {
  if (!existsSync(eventsFile)) return new Map();
  const counts = new Map<string, number>();
  for (const line of (await readFile(eventsFile, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const entry = readJsonLine(line);
    const event = recordValue(recordValue(entry).event ?? entry);
    if (event.type !== "tool_execution_start") continue;
    const toolName = stringValue(event.toolName) ?? "tool";
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }
  return counts;
}

async function readBashCommands(sessionFile: string): Promise<string[]> {
  if (!existsSync(sessionFile)) return [];
  const commands: string[] = [];
  for (const line of (await readFile(sessionFile, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    collectBashCommands(readJsonLine(line), commands);
  }
  return commands;
}

function collectBashCommands(value: unknown, commands: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectBashCommands(item, commands);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const object = value as Record<string, unknown>;
  if (object.type === "toolCall" && object.name === "bash") {
    const command = stringValue(recordValue(object.arguments).command);
    if (command) commands.push(command);
  }
  for (const child of Object.values(object)) collectBashCommands(child, commands);
}

function renderWorkflowLogReview(cwd: string, review: WorkflowLogReview): string {
  const totalInput = review.agents.reduce((total, agent) => total + agent.inputTokenCount, 0);
  const totalOutput = review.agents.reduce((total, agent) => total + agent.outputTokenCount, 0);
  const totalTokens = review.agents.reduce((total, agent) => total + agent.tokenCount, 0);
  const totalTools = review.agents.reduce((total, agent) => total + agent.toolCallCount, 0);
  const topAgents = [...review.agents].sort((left, right) => right.tokenCount - left.tokenCount).slice(0, 8);
  return [
    `# Workflow log cost review: ${review.workflowName}`,
    "",
    `Log: ${relativeOrAbsolute(cwd, review.logDir)}`,
    review.description ? `Description: ${review.description}` : undefined,
    "Goal: reduce token cost from actual workflow session logs.",
    "",
    "## Actual token spend",
    `Total: ${formatTokenCount(totalTokens)} tokens (${formatTokenCount(totalInput)} input / ${formatTokenCount(totalOutput)} output) across ${String(review.agents.length)} agents and ${String(totalTools)} tool calls.`,
    totalTokens === 0
      ? "No provider token usage was recorded; check provider/session support before optimizing from these numbers."
      : undefined,
    "",
    ...topAgentLines(topAgents, totalTokens),
    "",
    "## Repeated tool and command activity",
    ...toolLines(review.agents),
    "",
    "## Cost-reduction targets",
    ...recommendationLines(review.agents, totalTokens),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function topAgentLines(agents: WorkflowLogAgentReview[], totalTokens: number): string[] {
  if (!agents.length) return ["No child agents were recorded."];
  return agents.map((agent, index) => {
    const share = totalTokens > 0 ? ` · ${String(Math.round((agent.tokenCount / totalTokens) * 100))}%` : "";
    const phase = agent.phase ? ` · phase ${agent.phase}` : "";
    const model = agent.model ? ` · ${agent.model}` : "";
    return `${String(index + 1)}. #${String(agent.id)} ${agent.label}${phase}: ${formatTokenCount(agent.tokenCount)} tokens (${formatTokenCount(agent.inputTokenCount)} in / ${formatTokenCount(agent.outputTokenCount)} out)${share}${model}`;
  });
}

function toolLines(agents: WorkflowLogAgentReview[]): string[] {
  const toolCounts = new Map<string, number>();
  const commandCounts = new Map<string, { count: number; agents: Set<string> }>();
  for (const agent of agents) {
    for (const [tool, count] of agent.toolCounts) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + count);
    for (const command of agent.bashCommands) {
      const current = commandCounts.get(command) ?? { count: 0, agents: new Set<string>() };
      current.count += 1;
      current.agents.add(agent.label);
      commandCounts.set(command, current);
    }
  }
  const tools = [...toolCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8);
  const commands = [...commandCounts.entries()].sort((left, right) => right[1].count - left[1].count).slice(0, 8);
  return [
    tools.length ? "Top tools:" : "No tool lifecycle events were recorded.",
    ...tools.map(([tool, count]) => `- ${tool}: ${String(count)} calls`),
    commands.length ? "Common bash commands:" : "No bash commands were found in child session transcripts.",
    ...commands.map(([command, info]) => `- ${String(info.count)}× across ${String(info.agents.size)} agent(s): ${inlineCode(command)}`),
  ];
}

function recommendationLines(agents: WorkflowLogAgentReview[], totalTokens: number): string[] {
  const lines: string[] = [];
  for (const agent of agents.filter((agent) => totalTokens > 0 && agent.tokenCount / totalTokens >= 0.25).slice(0, 3)) {
    const percent = String(Math.round((agent.tokenCount / totalTokens) * 100));
    lines.push(`- Focus first on '${agent.label}': it used ${percent}% of recorded tokens.`);
  }
  for (const [command, agentCount] of repeatedBashCommands(agents).slice(0, 5)) {
    lines.push(
      `- Command repeated across ${String(agentCount)} agents: ${inlineCode(command)}. Run it once in setup and pass the artifact/path to later agents.`,
    );
  }
  const totalReadCalls = agents.reduce((total, agent) => total + (agent.toolCounts.get("read") ?? 0), 0);
  if (totalReadCalls >= 5)
    lines.push(
      "- Many read calls were repeated; add a cheap indexing/summarization phase and pass concise file lists instead of full content.",
    );
  if (agents.some((agent) => agent.inputTokenCount > agent.outputTokenCount * 4 && agent.inputTokenCount >= 10_000)) {
    lines.push("- Input tokens dominate; move bulk context into files and prompts that reference paths, not pasted content.");
  }
  if (!lines.length)
    lines.push(
      "- No single obvious token sink was recorded. Re-run with provider usage and child session logging enabled if this looks suspicious.",
    );
  return lines;
}

function repeatedBashCommands(agents: WorkflowLogAgentReview[]): [string, number][] {
  const commandAgents = new Map<string, Set<string>>();
  for (const agent of agents) {
    for (const command of new Set(agent.bashCommands)) {
      const set = commandAgents.get(command) ?? new Set<string>();
      set.add(agent.label);
      commandAgents.set(command, set);
    }
  }
  return [...commandAgents.entries()]
    .filter(([, agentSet]) => agentSet.size > 1)
    .map(([command, agentSet]) => [command, agentSet.size] as [string, number])
    .sort((left, right) => right[1] - left[1]);
}

function relativeOrAbsolute(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;
}

function inlineCode(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function readObject(text: string, label: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value as Record<string, unknown>;
}

function readJsonLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
