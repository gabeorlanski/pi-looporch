import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { workflowNaturalLanguageRequestMessage, workflowRunRequestMessage } from "../src/workflow-command.ts";
import { discoverWorkflows } from "../src/workflow-discovery.ts";
import { createPiWorkflowAgent } from "../src/pi-agent.ts";
import { type GeneratedWorkflowDraft, type WorkflowReviewer } from "../src/workflow-request.ts";
import { normalizeWorkflowName } from "../src/workflow-runtime.ts";
import { workflowApprovalLines } from "../src/workflow-review.ts";
import { createWorkflowTools } from "../src/workflow-tools.ts";

const MESSAGE_TYPE = "pi-workflow-message";

export default function piWorkflow(pi: ExtensionAPI) {
  const aliases = new Set<string>();

  for (const tool of createWorkflowTools({
    agentForContext: (ctx) => createPiWorkflowAgent({ cwd: ctx.cwd, reviewer: createReviewer(ctx) }),
    reviewerForContext: (ctx) => createReviewer(ctx),
  })) {
    pi.registerTool(tool);
  }

  pi.registerCommand("workflow", {
    description: "Run or create a project workflow in the current session",
    getArgumentCompletions: (prefix) => workflowCompletions(process.cwd(), prefix),
    handler: async (args, ctx) => steerWorkflowCommand(pi, ctx, undefined, args),
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
        handler: async (args, commandCtx) => steerWorkflowCommand(pi, commandCtx, workflow.name, args),
      });
    }
  });
}

async function steerWorkflowCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
): Promise<void> {
  const message = await workflowSteerMessage(ctx, fixedWorkflowName, args);
  if (!message.ok) {
    ctx.ui.notify(message.message, "warning");
    return;
  }
  ctx.ui.notify("Workflow request sent to current session", "info");
  sendWhenReady(pi, ctx, message.message);
}

async function workflowSteerMessage(
  ctx: ExtensionCommandContext,
  fixedWorkflowName: string | undefined,
  args: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (fixedWorkflowName) return { ok: true, message: workflowRunRequestMessage(normalizeWorkflowName(fixedWorkflowName), parseWorkflowInput(args)) };

  const workflows = await discoverWorkflows(ctx.cwd);
  const names = workflows.map((workflow) => workflow.name);
  const trimmed = args.trim();
  if (!trimmed) return { ok: false, message: names.length ? `Usage: /workflow <name> [input]. Available: ${names.join(", ")}` : "No workflows found." };

  const [first, rest] = splitFirstWord(trimmed);
  if (names.includes(first)) return { ok: true, message: workflowRunRequestMessage(first, parseWorkflowInput(rest)) };

  return { ok: true, message: workflowNaturalLanguageRequestMessage(trimmed, names) };
}

function sendWhenReady(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(message);
    return;
  }
  pi.sendUserMessage(message, { deliverAs: "followUp" });
}

function createReviewer(ctx: ExtensionContext): WorkflowReviewer {
  return async ({ draft }) => {
    if (ctx.mode !== "tui") return { action: "reject", reason: "Generated workflows require TUI review before save or run" };
    return (await reviewGeneratedWorkflow(ctx, draft)) ? { action: "approve" } : { action: "reject", reason: "Generated workflow was rejected" };
  };
}

async function reviewGeneratedWorkflow(ctx: ExtensionContext, draft: GeneratedWorkflowDraft): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => ({
    render(width: number): string[] {
      return workflowApprovalLines(draft).map((line) => {
        const styled = line.includes("Workflow approval")
          ? theme.fg("accent", theme.bold(line))
          : line.includes("Decision") || line.includes("approve")
            ? theme.fg("success", line)
            : line.includes("Review checklist") || line.includes("Goal") || line.includes("Steps") || line.includes("What will run")
              ? theme.bold(line)
              : line;
        return truncateToWidth(styled, width);
      });
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
