import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { discoverWorkflows, workflowRootsForProject } from "../src/workflow-discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { resolveWorkflowRequest, type GeneratedWorkflowDraft, type WorkflowReviewer } from "../src/workflow-request.ts";
import { normalizeWorkflowName, runWorkflowFromDirectory, type WorkflowRunResult, type WorkflowSnapshot } from "../src/workflow-runtime.ts";

const MESSAGE_TYPE = "pi-workflow-message";

export default function piWorkflow(pi: ExtensionAPI) {
  const aliases = new Set<string>();

  pi.registerCommand("workflow", {
    description: "Run or create a project workflow",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => runWorkflowCommand(pi, ctx, undefined, args),
  });

  pi.registerCommand("workflow-review", {
    description: "Inspect an existing workflow definition",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => reviewWorkflowCommand(pi, ctx, args),
  });

  pi.on("session_start", async (_event, ctx) => {
    for (const workflow of await discoverWorkflows(ctx.cwd)) {
      const command = `workflow:${workflow.name}`;
      if (aliases.has(command)) continue;
      aliases.add(command);
      pi.registerCommand(command, {
        description: workflow.metadata.description,
        handler: async (args, commandCtx) => runWorkflowCommand(pi, commandCtx, workflow.name, args),
      });
    }
  });
}

async function runWorkflowCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
): Promise<void> {
  const parsed = await parseWorkflowCommand(ctx, fixedWorkflowName, args);
  if (!parsed.ok) {
    ctx.ui.notify(parsed.message, "warning");
    return;
  }

  const controller = new AbortController();
  const agent = createPiWorkflowAgent({ cwd: ctx.cwd });
  const workflowRoots = await workflowRootsForProject(ctx.cwd);
  const run = (onSnapshot?: (snapshot: WorkflowSnapshot) => void) =>
    runWorkflowFromDirectory({
      cwd: ctx.cwd,
      workflowName: parsed.workflowName,
      input: parsed.input,
      agent,
      workflowRoots,
      signal: controller.signal,
      onSnapshot,
    });

  const result = ctx.mode === "tui" ? await runWithPanel(ctx, controller, run) : await run();
  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content: `Workflow ${result.workflowName} complete.\n\n${JSON.stringify(result.result, null, 2)}`,
    display: true,
    details: undefined,
  });
}

async function parseWorkflowCommand(
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
): Promise<{ ok: true; workflowName: string; input: unknown } | { ok: false; message: string }> {
  if (fixedWorkflowName) return { ok: true, workflowName: normalizeWorkflowName(fixedWorkflowName), input: parseWorkflowInput(args) };

  const workflows = await discoverWorkflows(ctx.cwd);
  const names = workflows.map((workflow) => workflow.name);
  const trimmed = args.trim();
  if (!trimmed) return { ok: false, message: names.length ? `Usage: /workflow <name> [input]. Available: ${names.join(", ")}` : "No workflows found." };

  const [first, rest] = splitFirstWord(trimmed);
  if (names.includes(first)) return { ok: true, workflowName: first, input: parseWorkflowInput(rest) };

  const resolved = await resolveWorkflowRequest({
    cwd: ctx.cwd,
    request: trimmed,
    agent: createPiWorkflowAgent({ cwd: ctx.cwd }),
    reviewer: createReviewer(ctx),
  });
  if (resolved.action === "created") ctx.ui.notify(`Saved reviewed workflow '${resolved.name}'.`, "info");
  return { ok: true, workflowName: resolved.name, input: resolved.input };
}

function createReviewer(ctx: ExtensionCommandContext): WorkflowReviewer {
  return async ({ draft }) => {
    if (ctx.mode !== "tui") return { action: "reject", reason: "Generated workflows require TUI review before save or run" };
    return (await reviewGeneratedWorkflow(ctx, draft)) ? { action: "approve" } : { action: "reject", reason: "Generated workflow was rejected" };
  };
}

async function reviewGeneratedWorkflow(ctx: ExtensionCommandContext, draft: GeneratedWorkflowDraft): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => ({
    render(width: number): string[] {
      return [
        theme.fg("accent", theme.bold(`Review ${draft.name}`)),
        theme.fg("dim", draft.metadata.description),
        "",
        ...draft.source.split("\n").slice(0, 30),
        "",
        theme.fg("success", "y approve, n reject"),
      ].map((line) => truncateToWidth(line, width));
    },
    handleInput(data: string): void {
      if (data === "y" || data === "Y") done(true);
      if (data === "n" || data === "N" || matchesKey(data, Key.escape)) done(false);
    },
    invalidate(): void {
      tui.requestRender();
    },
  }));
}

async function runWithPanel(
  ctx: ExtensionCommandContext,
  controller: AbortController,
  run: (onSnapshot: (snapshot: WorkflowSnapshot) => void) => Promise<WorkflowRunResult>,
): Promise<WorkflowRunResult> {
  const outcome = await ctx.ui.custom<{ ok: true; result: WorkflowRunResult } | { ok: false; error: string }>((tui, theme, _keybindings, done) => {
    let snapshot: WorkflowSnapshot | undefined;
    const panel: Component = {
      render(width: number): string[] {
        const agents = snapshot?.agents ?? [];
        const fanOuts = snapshot?.fanOuts ?? [];
        const tokenCount = agents.reduce((total, agent) => total + agent.tokenCount, 0);
        const lines = [
          theme.fg("accent", theme.bold(snapshot ? `Workflow ${snapshot.workflowName}` : "Workflow starting")),
          snapshot?.phases.at(-1) ? `phase: ${snapshot.phases.at(-1)}` : undefined,
          ...fanOutLines(fanOuts, agents),
          ungroupedAgentLine(agents),
          tokenCount ? `tokens: ${tokenCount}` : undefined,
          "Esc cancels",
        ].filter((line): line is string => Boolean(line));
        return lines.map((line) => truncateToWidth(line, width));
      },
      handleInput(data: string): void {
        if (matchesKey(data, Key.escape)) controller.abort();
      },
      invalidate(): void {},
    };

    void run((nextSnapshot) => {
      snapshot = nextSnapshot;
      tui.requestRender();
    }).then(
      (result) => done({ ok: true, result }),
      (error: unknown) => done({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return panel;
  });

  if (outcome.ok) return outcome.result;
  throw new Error(outcome.error);
}

function fanOutLines(fanOuts: WorkflowSnapshot["fanOuts"], agents: WorkflowSnapshot["agents"]): string[] {
  return fanOuts.slice(-3).flatMap((fanOut) => {
    const children = agents.filter((agent) => agent.fanOutId === fanOut.id);
    return [
      `fan-out ${fanOut.label}: ${fanOut.done}/${fanOut.total}${fanOut.running ? ` (${fanOut.running} running)` : ""}`,
      ...children.slice(-6).map((agent) => `  ${agent.status} ${agent.label}${agent.tokenCount ? ` · ${agent.tokenCount} tokens` : ""}${agent.message ? ` · ${agent.message}` : ""}`),
    ];
  });
}

function ungroupedAgentLine(agents: WorkflowSnapshot["agents"]): string | undefined {
  const ungrouped = agents.filter((agent) => agent.fanOutId === undefined);
  return ungrouped.length ? `agents: ${ungrouped.filter((agent) => agent.status === "done").length}/${ungrouped.length}` : undefined;
}

async function reviewWorkflowCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  const name = normalizeWorkflowName(args.trim());
  const workflow = (await discoverWorkflows(ctx.cwd)).find((candidate) => candidate.name === name);
  if (!workflow) {
    ctx.ui.notify(`Workflow '${name}' not found.`, "warning");
    return;
  }
  pi.sendMessage({ customType: MESSAGE_TYPE, content: await readFile(workflow.entryFile, "utf8"), display: true, details: undefined });
}

function parseWorkflowInput(text: string): unknown {
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

async function workflowCompletions(cwd: string, prefix: string): Promise<Array<{ value: string; label: string }> | null> {
  const matches = (await discoverWorkflows(cwd)).map((workflow) => workflow.name).filter((name) => name.startsWith(prefix));
  return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
}
