/** Provides status behavior. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { renderWorkflowStatus, renderWorkflowStatusJson, renderWorkflowStatusList } from "../../src/display/workflow-status.ts";
import { readSelectedWorkflowStatus, readWorkflowStatusList, type WorkflowStatusQuery } from "../../src/workflow/status.ts";
import { WORKFLOW_MESSAGE_TYPE } from "../messages.ts";

const WORKFLOW_STATUS_USAGE = "Usage: /workflow-status [--json] [--all] [latest|<run-id>|<workflow>|<outputsDir>]";

interface WorkflowStatusCommandArgs {
  ref: string;
  includeCompleted: boolean;
  all: boolean;
  format: "summary" | "json";
}

/** Provides the workflowStatusCommand function contract. */
export async function workflowStatusCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  try {
    const parsed = parseWorkflowStatusArgs(args);
    const query: WorkflowStatusQuery = {
      scope: "project",
      ownerSessionId: ctx.sessionManager.getSessionId(),
      ref: parsed.ref,
      includeCompleted: parsed.includeCompleted,
      now: Date.now(),
    };
    const { content, details } = parsed.all
      ? await workflowStatusListContent(ctx.cwd, query, parsed.format)
      : await selectedWorkflowStatusContent(ctx.cwd, query, parsed.format);
    pi.sendMessage({
      customType: WORKFLOW_MESSAGE_TYPE,
      content,
      display: true,
      details,
    });
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

function parseWorkflowStatusArgs(args: string): WorkflowStatusCommandArgs {
  let ref: string | undefined;
  const parsed: Omit<WorkflowStatusCommandArgs, "ref"> = { includeCompleted: false, all: false, format: "summary" };
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    if (token === "--json") parsed.format = "json";
    else if (token === "--all") {
      parsed.all = true;
      parsed.includeCompleted = true;
    } else if (token.startsWith("--")) throw new Error(WORKFLOW_STATUS_USAGE);
    else if (!ref) ref = token;
    else throw new Error(WORKFLOW_STATUS_USAGE);
  }
  return { ...parsed, ref: ref ?? "latest" };
}

async function workflowStatusListContent(
  cwd: string,
  query: WorkflowStatusQuery,
  format: "summary" | "json",
): Promise<{ content: string; details: unknown }> {
  const statuses = await readWorkflowStatusList(cwd, query);
  return {
    content: format === "json" ? `${JSON.stringify(statuses, null, 2)}\n` : renderWorkflowStatusList(statuses),
    details: { kind: "workflow-status-list", statuses },
  };
}

async function selectedWorkflowStatusContent(
  cwd: string,
  query: WorkflowStatusQuery,
  format: "summary" | "json",
): Promise<{ content: string; details: unknown }> {
  const status = await readSelectedWorkflowStatus(cwd, query);
  return {
    content: format === "json" ? renderWorkflowStatusJson(status) : renderWorkflowStatus(status),
    details: status,
  };
}
