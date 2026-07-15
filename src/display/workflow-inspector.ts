/** Provides workflow inspector behavior. */
import { readFileSync } from "node:fs";
import { type Component, type Focusable, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { WorkflowUiAgent, WorkflowUiPhase, WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import type { WorkflowTuiTheme } from "./workflow-tui-format.ts";
import {
  fmtCostUsd,
  fmtDuration,
  fmtTokens,
  glyph,
  joinColumns,
  padTo,
  panel,
  spinnerFrame,
  truncEnd,
  width,
} from "./workflow-tui-format.ts";

type Level = "phases" | "detail";

const LEFT_W = 26;

/** Provides the WorkflowInspector class contract. */
export class WorkflowInspector implements Component, Focusable {
  focused = false;
  onClose?: () => void;
  onAbort?: () => void;
  private level: Level = "phases";
  private selectedPhase = 0;
  private selectedAgent = 0;
  private promptExpanded = false;
  private scroll = 0;
  private note = "";

  constructor(
    private readonly model: WorkflowInspectorModel,
    private readonly theme: WorkflowTuiTheme,
    private readonly getHeight: () => number,
  ) {}

  invalidate(): void {
    return undefined;
  }

  dispose(): void {
    return undefined;
  }

  handleInput(data: string): void {
    this.note = "";
    if (this.level === "phases") this.handlePhases(data);
    else this.handleDetail(data);
  }

  render(termWidth: number): string[] {
    const height = Math.max(8, this.getHeight());
    const workflow = this.model.workflow();
    const statusTag =
      workflow.status === "error" ? this.theme.danger(" [error]") : workflow.status === "done" ? this.theme.ok(" [done]") : "";
    const title = ` ${this.theme.accent(this.theme.bold(workflow.name))}${statusTag}`;
    const stats = `${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents ${glyph.mid} ${fmtDuration(workflow.elapsed)} ${glyph.mid} in ${fmtTokens(workflow.inputTokens)} ${glyph.mid} cached ${fmtTokens(workflow.cachedTokens)} ${glyph.mid} out ${fmtTokens(workflow.outputTokens)} ${glyph.mid} ${fmtCostUsd(workflow.costUsd, workflow.costIncomplete)}`;
    const header = rightAlign(title, this.theme.dim(truncEnd(stats, Math.max(0, termWidth - width(title) - 1))), termWidth);
    const subtitle = padTo(` ${this.theme.dim(truncEnd(workflow.subtitle, termWidth - 2))}`, termWidth);
    const panelHeight = Math.max(3, height - 5);
    const body = this.level === "phases" ? this.renderPhases(termWidth, panelHeight) : this.renderDetail(termWidth, panelHeight);
    const out = [padTo(header, termWidth), subtitle, padTo("", termWidth), ...body, padTo("", termWidth), padTo(this.footer(), termWidth)];
    while (out.length < height) out.push(padTo("", termWidth));
    return out.slice(0, height);
  }

  private handlePhases(data: string): void {
    if (matchesKey(data, "up")) this.selectedPhase = clamp(this.selectedPhase - 1, 0, this.phases().length - 1);
    else if (matchesKey(data, "down")) this.selectedPhase = clamp(this.selectedPhase + 1, 0, this.phases().length - 1);
    else if (matchesKey(data, "right") || matchesKey(data, "enter")) {
      this.level = "detail";
      this.selectedAgent = 0;
      this.scroll = 0;
      this.promptExpanded = false;
    } else if (matchesKey(data, "escape") || matchesKey(data, "backspace") || matchesKey(data, "left")) this.onClose?.();
    else if (matchesKey(data, "x")) {
      this.onAbort?.();
      this.note = "abort requested";
    } else if (matchesKey(data, "s")) this.note = "snapshot is persisted in workflow session logs";
  }

  private handleDetail(data: string): void {
    if (matchesKey(data, "up")) {
      this.selectedAgent = clamp(this.selectedAgent - 1, 0, this.currentPhase().agents.length - 1);
      this.scroll = 0;
      this.promptExpanded = false;
    } else if (matchesKey(data, "down")) {
      this.selectedAgent = clamp(this.selectedAgent + 1, 0, this.currentPhase().agents.length - 1);
      this.scroll = 0;
      this.promptExpanded = false;
    } else if (matchesKey(data, "k")) this.scroll = Math.max(0, this.scroll - 1);
    else if (matchesKey(data, "j")) this.scroll++;
    else if (matchesKey(data, "enter")) this.promptExpanded = !this.promptExpanded;
    else if (matchesKey(data, "escape") || matchesKey(data, "backspace") || matchesKey(data, "left")) this.level = "phases";
    else if (matchesKey(data, "x")) {
      this.onAbort?.();
      this.note = "abort requested";
    } else if (matchesKey(data, "s")) this.note = "snapshot is persisted in workflow session logs";
  }

  private footer(): string {
    if (this.note) return ` ${this.theme.warn(this.note)}`;
    const text =
      this.level === "phases"
        ? `${glyph.updown} select ${glyph.mid} → agents ${glyph.mid} x abort workflow ${glyph.mid} esc back ${glyph.mid} s snapshot path`
        : `${glyph.arrowUp}${glyph.arrowDown} agent ${glyph.mid} j/k scroll ${glyph.mid} ${glyph.enter} prompt ${glyph.mid} x abort ${glyph.mid} esc back`;
    return ` ${this.theme.dim(text)}`;
  }

  private renderPhases(termWidth: number, height: number): string[] {
    const phases = this.phases();
    const left = phases.slice(0, height - 2).map((phase, index) => {
      const selected = index === this.selectedPhase;
      const marker = selected ? this.theme.accent(glyph.marker) : " ";
      const count = phase.agentsTotal === 0 ? "" : `${String(phase.agentsDone)}/${String(phase.agentsTotal)}`;
      const name = phase.status === "pending" ? this.theme.pending(phase.name) : phase.name;
      let row =
        padTo(`${marker}${phaseGlyph(phase, this.model.tick, this.theme)} ${name}`, LEFT_W - 3 - width(count)) + this.theme.dim(count);
      if (selected) row = this.theme.selected(padTo(truncEnd(row, LEFT_W - 2), LEFT_W - 2));
      return row;
    });
    const phase = this.currentPhase();
    const rightTitle = `${phase.name} ${glyph.mid} ${String(phase.agentsTotal)} agents`;
    const rightWidth = Math.max(20, termWidth - LEFT_W);
    const body = phase.agents.length
      ? phase.agents.slice(0, height - 2).map((agent) => agentPreviewRow(agent, rightWidth - 2, this.model.tick, this.theme))
      : [this.theme.dim(phase.detail ?? "No agents launched for this phase yet.")];
    return joinColumns(panel(this.theme, "Phases", left, LEFT_W, height), panel(this.theme, rightTitle, body, rightWidth, height));
  }

  private renderDetail(termWidth: number, height: number): string[] {
    const phase = this.currentPhase();
    const left = phase.agents.slice(0, height - 2).map((agent, index) => {
      const selected = index === this.selectedAgent;
      const marker = selected ? this.theme.accent(glyph.marker) : " ";
      let row = `${marker}${agentGlyph(agent, this.model.tick, this.theme)} ${truncEnd(agent.displayName, LEFT_W - 5)}`;
      if (selected) row = this.theme.selected(padTo(truncEnd(row, LEFT_W - 2), LEFT_W - 2));
      return row;
    });
    const rightInner = Math.max(18, termWidth - LEFT_W - 2);
    const doc = this.buildDetailDoc(rightInner);
    const windowHeight = Math.max(1, height - 3);
    this.scroll = clamp(this.scroll, 0, Math.max(0, doc.length - windowHeight));
    const windowLines = doc.slice(this.scroll, this.scroll + windowHeight);
    while (windowLines.length < windowHeight) windowLines.push("");
    windowLines.push(rangeIndicator(this.scroll, windowHeight, doc.length, rightInner, this.theme));
    const agent = this.currentAgent();
    return joinColumns(
      panel(this.theme, `${phase.name} ${glyph.mid} ${String(phase.agents.length)} agents`, left, LEFT_W, height),
      panel(this.theme, agent ? agent.displayName : phase.name, windowLines, Math.max(20, termWidth - LEFT_W), height),
    );
  }

  private buildDetailDoc(innerWidth: number): string[] {
    const agent = this.currentAgent();
    if (!agent) return [this.theme.dim("No agent selected.")];
    const lines: string[] = [];
    const push = (line = ""): void => {
      lines.push(truncEnd(line, innerWidth));
    };
    const pushExact = (line = ""): void => {
      for (const wrapped of wrapExactLine(line, innerWidth)) lines.push(wrapped);
    };
    push(`${agentGlyph(agent, this.model.tick, this.theme)} ${statusWord(agent.status)} ${glyph.mid} ${agent.model}`);
    push(
      this.theme.dim(
        `${fmtTokens(agent.inputTokens)} in ${glyph.mid} ${fmtTokens(agent.cachedTokens)} cached ${glyph.mid} ${fmtTokens(agent.outputTokens)} out ${glyph.mid} ${fmtCostUsd(agent.costUsd ?? 0, agent.costUsd === undefined)} ${glyph.mid} ${String(agent.toolCalls)} tools ${glyph.mid} ${String(agent.steps)} steps ${glyph.mid} ${fmtDuration(agent.durationSeconds, true)}`,
      ),
    );
    push("");
    push(this.theme.accent(`Details ${glyph.mid} ${String(agent.detailLines.length)} lines`));
    for (const line of agent.detailLines) push(`  ${line}`);
    push("");
    const prompt = this.promptExpanded ? readTextArtifact(agent.promptPath) : undefined;
    push(
      this.theme.accent(
        `Prompt ${glyph.mid} ${agent.promptPath ? "recorded" : "not recorded"} ${glyph.mid} ${glyph.enter} ${this.promptExpanded ? "collapse" : "expand"}`,
      ),
    );
    if (this.promptExpanded) for (const line of (prompt ?? "No prompt artifact recorded.").split("\n")) pushExact(`  ${line}`);
    else push(this.theme.dim("  Prompt hidden. Press enter to show the exact prompt sent to this agent."));
    push("");
    const toolActivity = readToolActivityArtifact(agent.activityPath);
    const recentToolActivity = toolActivity.slice(-3);
    push(this.theme.accent(`Activity ${glyph.mid} last ${String(recentToolActivity.length)} of ${String(toolActivity.length)} tool uses`));
    for (const line of recentToolActivity) pushExact(`  ${line}`);
    if (toolActivity.length === 0) push(this.theme.dim("  No tool usage recorded yet."));
    push("");
    push(this.theme.accent("Output"));
    for (const line of agentOutput(agent).split("\n")) pushExact(`  ${line}`);
    return lines;
  }

  private phases(): WorkflowUiPhase[] {
    return this.model.workflow().phases;
  }

  private currentPhase(): WorkflowUiPhase {
    const phases = this.phases();
    const selectedPhase = clamp(this.selectedPhase, 0, phases.length - 1);
    return phases[selectedPhase] ?? { index: 0, name: "Workflow", status: "pending", agentsDone: 0, agentsTotal: 0, agents: [] };
  }

  private currentAgent(): WorkflowUiAgent | undefined {
    const agents = this.currentPhase().agents;
    const selectedAgent = clamp(this.selectedAgent, 0, agents.length - 1);
    return agents[selectedAgent];
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function rightAlign(left: string, right: string, termWidth: number): string {
  return left + " ".repeat(Math.max(1, termWidth - width(left) - width(right))) + right;
}

function phaseGlyph(phase: WorkflowUiPhase, tick: number, theme: WorkflowTuiTheme): string {
  if (phase.status === "done") return theme.ok(glyph.done);
  if (phase.status === "running") return theme.warn(spinnerFrame(tick));
  if (phase.status === "error") return theme.danger("✗");
  return theme.pending(String(phase.index));
}

function agentGlyph(agent: WorkflowUiAgent, tick: number, theme: WorkflowTuiTheme): string {
  if (agent.status === "completed") return theme.ok(glyph.done);
  if (agent.status === "running") return theme.warn(spinnerFrame(tick));
  return theme.danger("✗");
}

function statusWord(status: WorkflowUiAgent["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  return "Failed";
}

function agentPreviewRow(agent: WorkflowUiAgent, rowWidth: number, tick: number, theme: WorkflowTuiTheme): string {
  const stats = `${fmtTokens(agent.inputTokens + agent.outputTokens)} tok ${glyph.mid} ${fmtTokens(agent.cachedTokens)} cached ${glyph.mid} ${fmtCostUsd(agent.costUsd ?? 0, agent.costUsd === undefined)} ${glyph.mid} ${String(agent.toolCalls)} tools ${glyph.mid} ${fmtDuration(agent.durationSeconds)}`;
  const left = `${agentGlyph(agent, tick, theme)} ${truncEnd(agent.displayName, Math.max(8, rowWidth - width(stats) - 14))}  ${theme.dim(agent.model)}`;
  return padTo(left, Math.max(0, rowWidth - width(stats))) + theme.dim(stats);
}

function wrapExactLine(line: string, rowWidth: number): string[] {
  if (rowWidth <= 0) return [""];
  return wrapTextWithAnsi(line, rowWidth);
}

function readTextArtifact(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  try {
    return readFileSync(filePath, "utf8").replace(/\n$/, "");
  } catch {
    return undefined;
  }
}

function readToolActivityArtifact(filePath: string | undefined): string[] {
  const text = readTextArtifact(filePath);
  if (!text) return [];
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map(toolActivityLine);
}

function toolActivityLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as { name?: unknown; arguments?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name : "tool";
    if (parsed.arguments === undefined) return name;
    return `${name} ${JSON.stringify(parsed.arguments)}`;
  } catch {
    return line;
  }
}

function agentOutput(agent: WorkflowUiAgent): string {
  if (agent.error) return agent.error;
  if (agent.status === "running") return agent.message ?? "Agent is still running.";
  const text = readTextArtifact(agent.outputPath);
  if (text === undefined) return agent.outputPath ? `Output artifact unavailable: ${agent.outputPath}` : "No output recorded.";
  return outputArtifactText(text);
}

function outputArtifactText(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function rangeIndicator(scroll: number, windowHeight: number, total: number, rowWidth: number, theme: WorkflowTuiTheme): string {
  if (total <= windowHeight) return padTo("", rowWidth);
  const first = scroll + 1;
  const last = Math.min(scroll + windowHeight, total);
  const arrow = last < total ? glyph.arrowDown : glyph.arrowUp;
  const label = `${String(first)}–${String(last)} of ${String(total)} ${arrow}`;
  return padTo(rightAlign("", theme.dim(label), rowWidth), rowWidth);
}
