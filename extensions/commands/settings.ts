import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  readWorkflowSettings,
  writeGlobalWorkflowSettings,
  writeProjectWorkflowSettings,
  type WorkflowSettings,
  type WorkflowSettingsPatch,
} from "../../src/workflow/settings.ts";
import { WORKFLOW_MESSAGE_TYPE } from "../messages.ts";

export async function workflowSettingsCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
  const trimmed = args.trim();
  if (trimmed) {
    try {
      const { scope, settings } = parseWorkflowSettingsArgs(trimmed);
      if (scope === "global") {
        await writeGlobalWorkflowSettings(getAgentDir(), settings);
      } else {
        await writeProjectWorkflowSettings(ctx.cwd, settings);
      }
      ctx.ui.notify(workflowSettingsSavedMessage(scope, settings), "info");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    return;
  }
  const settings = await readWorkflowSettings(ctx.cwd, getAgentDir());
  pi.sendMessage({
    customType: WORKFLOW_MESSAGE_TYPE,
    content: workflowSettingsMessage(getAgentDir(), settings),
    display: true,
    details: { kind: "workflow-settings", settings },
  });
}

function parseWorkflowSettingsArgs(args: string): { scope: "global" | "project"; settings: WorkflowSettingsPatch } {
  const { scope, body } = parseWorkflowSettingsScope(args);
  const assignment = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/.exec(body);
  const name = assignment ? assignment[1] : /^\d+$/.test(body) ? "maxParallelAgents" : "";
  const value = assignment ? assignment[2] : body;
  return { scope, settings: parseWorkflowSetting(name, value) };
}

function parseWorkflowSettingsScope(args: string): { scope: "global" | "project"; body: string } {
  const trimmed = args.trim();
  if (trimmed.startsWith("--global ")) return { scope: "global", body: trimmed.slice("--global ".length).trim() };
  if (trimmed.startsWith("global ")) return { scope: "global", body: trimmed.slice("global ".length).trim() };
  if (trimmed.startsWith("scope=global ")) return { scope: "global", body: trimmed.slice("scope=global ".length).trim() };
  return { scope: "project", body: trimmed };
}

function workflowSettingsSavedMessage(scope: "global" | "project", settings: WorkflowSettingsPatch): string {
  const target = scope === "global" ? "global settings.json" : ".pi/settings.json";
  if (settings.maxParallelAgents !== undefined) {
    return `Workflow max parallel agents set to ${String(settings.maxParallelAgents)} in ${target}`;
  }
  if (settings.childAgentExtensions !== undefined) {
    return `Workflow child agent extensions set to ${formatSettingList(settings.childAgentExtensions)} in ${target}`;
  }
  if (settings.workflowDirs !== undefined) {
    return `Workflow directories set to ${formatSettingList(settings.workflowDirs)} in ${target}`;
  }
  return `Workflow settings saved in ${target}`;
}

function workflowSettingsMessage(agentDir: string, settings: WorkflowSettings): string {
  const globalSettings = `${agentDir}/settings.json`;
  return [
    "# Workflow Settings",
    "",
    `- Workflow directories: ${formatSettingList(settings.workflowDirs)}`,
    `- Max parallel agents: ${String(settings.maxParallelAgents)}`,
    `- Child agent extensions: ${formatSettingList(settings.childAgentExtensions)}`,
    "",
    "Settings are merged from project settings over global settings.",
    "",
    "- Project: .pi/settings.json",
    `- Global: ${globalSettings}`,
    "",
    "Commands:",
    "",
    "```text",
    ...workflowSettingExamples,
    "```",
  ].join("\n");
}

function parseWorkflowSetting(name: string, value: string): WorkflowSettingsPatch {
  switch (name) {
    case "maxParallelAgents":
    case "maxParallel":
      return { maxParallelAgents: Number(value) };
    case "childAgentExtensions":
    case "childExtensions":
    case "extensions":
      return { childAgentExtensions: parseSettingList(value) };
    case "workflowDirs":
    case "dirs":
      return { workflowDirs: parseSettingList(value) };
    default:
      throw new Error(workflowSettingsUsage());
  }
}

function parseSettingList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((entry) => entry.trim());
}

function formatSettingList(values: string[]): string {
  return values.length ? values.join(", ") : "none";
}

const workflowSettingExamples = [
  "/workflow-settings maxParallelAgents=8",
  "/workflow-settings --global maxParallelAgents=4",
  "/workflow-settings childAgentExtensions=pi-subagents,./extensions/todo.ts",
  "/workflow-settings --global childAgentExtensions=",
  "/workflow-settings workflowDirs=../shared-workflows,.pi/team-workflows",
];

function workflowSettingsUsage(): string {
  return "Usage: /workflow-settings [--global] maxParallelAgents=<positive integer> | workflowDirs=<path>[,<path>...] | childAgentExtensions=<extension>[,<extension>...]";
}
