import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { discoverLoops, loopRootsForProject } from "../src/loop-discovery.ts";
import { createPiLoopAgent } from "../src/pi-agent.ts";
import { normalizeLoopName, runLoopFromDirectory, type LoopRunResult, type LoopSnapshot } from "../src/loop-runtime.ts";

const RESULT_MESSAGE_TYPE = "pi-looporch-result";

export default function piLooporch(pi: ExtensionAPI) {
  const registeredAliases = new Set<string>();

  pi.registerMessageRenderer(RESULT_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as { loopName?: string; result?: unknown; snapshot?: LoopSnapshot } | undefined;
    const box = new Box(1, 1, (value: string) => theme.bg("customMessageBg", value));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(`Loop ${details?.loopName ?? "result"}`)), 0, 0));
    const summary = details?.snapshot
      ? `${details.snapshot.doneCount}/${details.snapshot.agentCount} agents · ~${details.snapshot.estimatedTokens} tokens`
      : "complete";
    const body = expanded
      ? [summary, "", JSON.stringify(details?.result ?? message.content, null, 2)].join("\n")
      : `${summary} (ctrl+o to expand)`;
    box.addChild(new Text(theme.fg("customMessageText", body), 0, 0));
    return box;
  });

  pi.registerCommand("loop", {
    description: "Run a project loop from .pi/loops/<name>/LOOP.md",
    getArgumentCompletions: (prefix) => loopCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => runLoopCommand(pi, ctx, undefined, args),
  });

  pi.on("session_start", async (_event, ctx) => {
    const loops = await discoverLoops(ctx.cwd);
    for (const { name } of loops) {
      const commandName = `loop:${name}`;
      if (registeredAliases.has(commandName)) continue;
      registeredAliases.add(commandName);
      pi.registerCommand(commandName, {
        description: `Run the ${name} loop`,
        handler: async (args, commandCtx) => runLoopCommand(pi, commandCtx, name, args),
      });
    }
  });
}

async function runLoopCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fixedLoopName: string | undefined,
  args: string,
): Promise<void> {
  const parsed = await parseLoopCommand(ctx.cwd, fixedLoopName, args);
  if (!parsed.ok) {
    ctx.ui.notify(parsed.message, "warning");
    return;
  }

  const agent = createPiLoopAgent({ cwd: ctx.cwd });
  const controller = new AbortController();
  const loopRoots = await loopRootsForProject(ctx.cwd);
  const run = (onSnapshot?: (snapshot: LoopSnapshot) => void) =>
    runLoopFromDirectory({
      cwd: ctx.cwd,
      loopName: parsed.loopName,
      input: parsed.input,
      agent,
      loopRoots,
      signal: controller.signal,
      onSnapshot,
    });

  const result = ctx.mode === "tui" ? await runWithPanel(ctx, controller, run) : await run();
  publishResult(pi, result);
}

async function runWithPanel(
  ctx: ExtensionCommandContext,
  controller: AbortController,
  run: (onSnapshot: (snapshot: LoopSnapshot) => void) => Promise<LoopRunResult>,
): Promise<LoopRunResult> {
  const outcome = await ctx.ui.custom<{ ok: true; result: LoopRunResult } | { ok: false; error: string }>((tui, theme, _keybindings, done) => {
    let snapshot: LoopSnapshot | undefined;
    let error: string | undefined;
    const panel: Component = {
      render(width: number): string[] {
        const lines = renderPanelLines(snapshot, error, width, {
          accent: (text) => theme.fg("accent", text),
          dim: (text) => theme.fg("dim", text),
          error: (text) => theme.fg("error", text),
          success: (text) => theme.fg("success", text),
          warning: (text) => theme.fg("warning", text),
          bold: (text) => theme.bold(text),
        });
        return lines.map((line) => truncateToWidth(line, width));
      },
      handleInput(data: string): void {
        if (matchesKey(data, Key.escape)) {
          error = "Cancelling loop...";
          controller.abort();
          tui.requestRender();
        }
      },
      invalidate(): void {},
    };

    void run((nextSnapshot) => {
      snapshot = nextSnapshot;
      tui.requestRender();
    }).then(
      (result) => done({ ok: true, result }),
      (caught: unknown) => done({ ok: false, error: caught instanceof Error ? caught.message : String(caught) }),
    );

    return panel;
  });

  if (outcome.ok) return outcome.result;
  throw new Error(outcome.error);
}

interface PanelTheme {
  accent(text: string): string;
  dim(text: string): string;
  error(text: string): string;
  success(text: string): string;
  warning(text: string): string;
  bold(text: string): string;
}

function renderPanelLines(snapshot: LoopSnapshot | undefined, error: string | undefined, width: number, theme: PanelTheme): string[] {
  if (!snapshot) return [theme.accent(theme.bold("Loop starting...")), theme.dim("Esc cancels")];
  const status = error
    ? theme.error(error)
    : snapshot.errorCount > 0
      ? theme.warning(`${snapshot.errorCount} failed`)
      : snapshot.runningCount > 0
        ? theme.accent(`${snapshot.runningCount} running`)
        : theme.success("complete");
  const lines = [
    `${theme.accent(theme.bold(`Loop ${snapshot.loopName}`))} ${theme.dim(snapshot.plan)}`,
    `${status} ${theme.dim(`${snapshot.doneCount}/${snapshot.agentCount} agents · ~${snapshot.estimatedTokens} tokens`)}`,
  ];
  if (snapshot.currentPhase) lines.push(`${theme.dim("phase:")} ${snapshot.currentPhase}`);
  if (snapshot.phases.length > 0) lines.push(`${theme.dim("plan:")} ${snapshot.phases.join(" → ")}`);
  for (const agent of snapshot.agents.slice(-6)) {
    const icon = agent.status === "done" ? theme.success("✓") : agent.status === "error" ? theme.error("✗") : theme.accent("●");
    lines.push(`  ${icon} #${agent.id} ${agent.label}${agentMetadata(agent, theme)}`);
    lines.push(`      ${theme.dim("status:")} ${agent.statusMessage ?? agent.status} · tools ${agent.toolUseCount}${agent.activeToolUseCount ? ` (${agent.activeToolUseCount} running)` : ""} · tokens ${agent.tokenCount}`);
    lines.push(`      ${theme.dim("task:")} ${shorten(agent.prompt, 110)}`);
    const files = filesForDisplay(agent);
    if (files.length) lines.push(`      ${theme.dim("files:")} ${shorten(files.join(", "), 100)}`);
    if (agent.status === "done" && agent.resultPreview) lines.push(`      ${theme.dim("result:")} ${shorten(agent.resultPreview, 90)}`);
    if (agent.status === "error" && agent.error) lines.push(`      ${theme.dim("error:")} ${theme.error(shorten(agent.error, 90))}`);
  }
  lines.push(theme.dim("Esc cancels"));
  return lines;
}

function agentMetadata(agent: LoopSnapshot["agents"][number], theme: PanelTheme): string {
  const parts = [agent.options.reasoning, agent.options.model].filter((part): part is string => Boolean(part));
  return parts.length ? theme.dim(` [${parts.join(" · ")}]`) : "";
}

function filesForDisplay(agent: LoopSnapshot["agents"][number]): string[] {
  return [...new Set([agent.options.taskFile, ...agent.filesTouched].filter((file): file is string => Boolean(file)))].map((file) => path.basename(file));
}

function shorten(value: string, max: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}…` : singleLine;
}

function publishResult(pi: ExtensionAPI, result: LoopRunResult): void {
  pi.sendMessage({
    customType: RESULT_MESSAGE_TYPE,
    content: `Loop ${result.loopName} complete. Result:\n${JSON.stringify(result.result, null, 2)}`,
    display: true,
    details: { loopName: result.loopName, result: result.result, snapshot: result.snapshot },
  });
}

type ParsedLoopCommand =
  | { ok: true; loopName: string; input: unknown }
  | { ok: false; message: string };

async function parseLoopCommand(cwd: string, fixedLoopName: string | undefined, args: string): Promise<ParsedLoopCommand> {
  if (fixedLoopName) return { ok: true, loopName: normalizeLoopName(fixedLoopName), input: parseLoopInput(args) };

  const loops = await discoverLoops(cwd);
  const names = loops.map((loop) => loop.name);
  const trimmed = args.trim();
  if (!trimmed) {
    if (names.length === 1) return { ok: true, loopName: names[0] ?? "", input: {} };
    return { ok: false, message: names.length ? `Usage: /loop <name> [json]. Available: ${names.join(", ")}` : "No loops found in .pi/loops." };
  }

  const [first, rest] = splitFirstWord(trimmed);
  if (names.includes(first)) return { ok: true, loopName: first, input: parseLoopInput(rest) };
  if (names.length === 1) return { ok: true, loopName: names[0] ?? "", input: parseLoopInput(trimmed) };
  return { ok: false, message: `Unknown loop '${first}'. Available: ${names.join(", ")}` };
}

function parseLoopInput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { prompt: trimmed };
  }
}

function splitFirstWord(text: string): [string, string] {
  const match = text.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return [match?.[1] ?? "", match?.[2] ?? ""];
}

async function loopCompletions(cwd: string, prefix: string): Promise<Array<{ value: string; label: string }> | null> {
  const loops = await discoverLoops(cwd);
  const matches = loops.map((loop) => loop.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
}
