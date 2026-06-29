import { type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { WorkflowUiAgent, WorkflowUiPhase, WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import type { WorkflowTuiTheme } from "./workflow-tui-format.ts";
import { fmtDuration, fmtTokens, glyph, joinColumns, padTo, panel, spinnerFrame, truncEnd, width } from "./workflow-tui-format.ts";

type Level = "phases" | "detail";

const LEFT_W = 26;

export class WorkflowInspector implements Component, Focusable {
  focused = false;
  onClose?: () => void;
  onAbort?: () => void;
  private level: Level = "phases";
  private selectedPhase = 0;
  private selectedAgent = 0;
  private detailsExpanded = false;
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
    const stats = `${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents ${glyph.mid} ${fmtDuration(workflow.elapsed)}`;
    const statusTag =
      workflow.status === "error" ? this.theme.danger(" [error]") : workflow.status === "done" ? this.theme.ok(" [done]") : "";
    const header = rightAlign(` ${this.theme.accent(this.theme.bold(workflow.name))}${statusTag}`, this.theme.dim(stats), termWidth);
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
      this.detailsExpanded = false;
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
      this.detailsExpanded = false;
    } else if (matchesKey(data, "down")) {
      this.selectedAgent = clamp(this.selectedAgent + 1, 0, this.currentPhase().agents.length - 1);
      this.scroll = 0;
      this.detailsExpanded = false;
    } else if (matchesKey(data, "k")) this.scroll = Math.max(0, this.scroll - 1);
    else if (matchesKey(data, "j")) this.scroll++;
    else if (matchesKey(data, "enter")) this.detailsExpanded = !this.detailsExpanded;
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
        : `${glyph.arrowUp}${glyph.arrowDown} agent ${glyph.mid} j/k scroll ${glyph.mid} ${glyph.enter} details ${glyph.mid} x abort ${glyph.mid} esc back`;
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
    push(`${agentStatusGlyph(agent, this.model.tick, this.theme)} ${statusWord(agent.status)} ${glyph.mid} ${agent.model}`);
    push(
      this.theme.dim(
        `${fmtTokens(agent.inputTokens)} in ${glyph.mid} ${fmtTokens(agent.outputTokens)} out ${glyph.mid} ${String(agent.toolCalls)} tools ${glyph.mid} ${String(agent.steps)} steps ${glyph.mid} ${fmtDuration(agent.durationSeconds, true)}`,
      ),
    );
    push("");
    push(
      this.theme.accent(
        `Details ${glyph.mid} ${String(agent.detailLines.length)} lines ${glyph.mid} ${glyph.enter} ${this.detailsExpanded ? "collapse" : "expand"}`,
      ),
    );
    const detailLines = this.detailsExpanded ? agent.detailLines : agent.detailLines.slice(0, 4);
    for (const line of detailLines) push(`  ${line}`);
    if (!this.detailsExpanded && agent.detailLines.length > detailLines.length)
      push(this.theme.dim(`  … ${String(agent.detailLines.length - detailLines.length)} more lines`));
    push("");
    push(this.theme.accent(`Activity ${glyph.mid} last ${String(Math.min(4, agent.activity.length))} of ${String(agent.activity.length)}`));
    for (const line of agent.activity.slice(-4)) push(`  ${line}`);
    if (agent.activity.length === 0) push(this.theme.dim("  No runtime messages recorded yet."));
    push("");
    push(this.theme.accent("Outcome"));
    for (const line of agent.outcome.split("\n")) push(`  ${line}`);
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

function agentStatusGlyph(agent: WorkflowUiAgent, tick: number, theme: WorkflowTuiTheme): string {
  return agentGlyph(agent, tick, theme);
}

function statusWord(status: WorkflowUiAgent["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  return "Failed";
}

function agentPreviewRow(agent: WorkflowUiAgent, rowWidth: number, tick: number, theme: WorkflowTuiTheme): string {
  const stats = `${fmtTokens(agent.inputTokens + agent.outputTokens)} tok ${glyph.mid} ${String(agent.toolCalls)} tools ${glyph.mid} ${fmtDuration(agent.durationSeconds)}`;
  const left = `${agentGlyph(agent, tick, theme)} ${truncEnd(agent.displayName, Math.max(8, rowWidth - width(stats) - 14))}  ${theme.dim(agent.model)}`;
  return padTo(left, Math.max(0, rowWidth - width(stats))) + theme.dim(stats);
}

function rangeIndicator(scroll: number, windowHeight: number, total: number, rowWidth: number, theme: WorkflowTuiTheme): string {
  if (total <= windowHeight) return padTo("", rowWidth);
  const first = scroll + 1;
  const last = Math.min(scroll + windowHeight, total);
  const arrow = last < total ? glyph.arrowDown : glyph.arrowUp;
  const label = `${String(first)}–${String(last)} of ${String(total)} ${arrow}`;
  return padTo(rightAlign("", theme.dim(label), rowWidth), rowWidth);
}
