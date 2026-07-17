/** Provides workflow inspector behavior. */
import { readFileSync } from "node:fs";
import { type Component, type Focusable, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { WorkflowUiCall, WorkflowUiPhase, WorkflowInspectorModel } from "./workflow-inspector-model.ts";
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

/** Provides the WorkflowInspector class contract. */
export class WorkflowInspector implements Component, Focusable {
  focused = false;
  onClose?: () => void;
  onAbort?: () => void;
  private level: Level = "phases";
  private selectedPhase = 0;
  private selectedCall = 0;
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
    const llmStats = workflow.llmsTotal > 0 ? ` ${glyph.mid} ${String(workflow.llmsDone)}/${String(workflow.llmsTotal)} LLM` : "";
    const stats = `${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents${llmStats} ${glyph.mid} ${fmtDuration(workflow.elapsed)}`;
    const renderedStats = this.theme.dim(truncEnd(stats, Math.floor(termWidth / 2)));
    const title = truncEnd(
      ` ${this.theme.accent(this.theme.bold(workflow.name))}${statusTag}`,
      Math.max(0, termWidth - width(renderedStats) - 1),
    );
    const header = rightAlign(title, renderedStats, termWidth);
    const inputUsage = `${this.theme.dim(" in ")}${this.theme.accent(fmtTokens(workflow.inputTokens))}${this.theme.dim(
      ` ${glyph.mid} cached ${fmtTokens(workflow.cachedTokens)}`,
    )}`;
    const outputUsage = `${this.theme.dim(` ${glyph.mid} out ${fmtTokens(workflow.outputTokens)} ${glyph.mid} `)}${this.theme.warn(fmtCostUsd(workflow.cost))}`;
    const usageLines = width(inputUsage + outputUsage) <= termWidth - 2 ? [inputUsage + outputUsage] : [inputUsage, outputUsage];
    const subtitle = padTo(` ${this.theme.dim(truncEnd(workflow.subtitle, termWidth - 2))}`, termWidth);
    const panelHeight = Math.max(3, height - 5 - (usageLines.length - 1));
    const body = this.level === "phases" ? this.renderPhases(termWidth, panelHeight) : this.renderDetail(termWidth, panelHeight);
    const out = [
      padTo(header, termWidth),
      ...usageLines.map((line) => padTo(line, termWidth)),
      subtitle,
      padTo("", termWidth),
      ...body,
      padTo("", termWidth),
      padTo(this.footer(), termWidth),
    ];
    while (out.length < height) out.push(padTo("", termWidth));
    return out.slice(0, height);
  }

  private handlePhases(data: string): void {
    if (matchesKey(data, "up")) this.selectedPhase = clamp(this.selectedPhase - 1, 0, this.phases().length - 1);
    else if (matchesKey(data, "down")) this.selectedPhase = clamp(this.selectedPhase + 1, 0, this.phases().length - 1);
    else if (matchesKey(data, "right") || matchesKey(data, "enter")) {
      this.level = "detail";
      this.selectedCall = 0;
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
      this.selectedCall = clamp(this.selectedCall - 1, 0, this.currentPhase().calls.length - 1);
      this.scroll = 0;
      this.promptExpanded = false;
    } else if (matchesKey(data, "down")) {
      this.selectedCall = clamp(this.selectedCall + 1, 0, this.currentPhase().calls.length - 1);
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
        ? `${glyph.updown} select ${glyph.mid} → calls ${glyph.mid} x abort workflow ${glyph.mid} esc back ${glyph.mid} s snapshot path`
        : `${glyph.arrowUp}${glyph.arrowDown} call ${glyph.mid} j/k scroll ${glyph.mid} ${glyph.enter} prompt ${glyph.mid} x abort ${glyph.mid} esc back`;
    return ` ${this.theme.dim(text)}`;
  }

  private renderPhases(termWidth: number, height: number): string[] {
    const phases = this.phases();
    const leftWidth = inspectorLeftWidth(
      termWidth,
      phases.map((phase) => phase.name),
    );
    const rightWidth = termWidth - leftWidth;
    const left = phases.slice(0, height - 2).map((phase, index) => {
      const selected = index === this.selectedPhase;
      const marker = selected ? this.theme.accent(glyph.marker) : " ";
      const count = phase.callsTotal === 0 ? "" : `${String(phase.callsDone)}/${String(phase.callsTotal)}`;
      const name = phase.status === "pending" ? this.theme.pending(phase.name) : phase.name;
      let row =
        padTo(`${marker}${phaseGlyph(phase, this.model.tick, this.theme)} ${name}`, leftWidth - 3 - width(count)) + this.theme.dim(count);
      if (selected) row = this.theme.selected(padTo(truncEnd(row, leftWidth - 2), leftWidth - 2));
      return row;
    });
    const phase = this.currentPhase();
    const rightTitle = `${phase.name} ${glyph.mid} ${String(phase.callsTotal)} calls`;
    const body = phase.calls.length
      ? phase.calls.slice(0, height - 2).map((call) => callPreviewRow(call, rightWidth - 2, this.model.tick, this.theme))
      : [this.theme.dim(phase.detail ?? "No model calls launched for this phase yet.")];
    return joinColumns(panel(this.theme, "Phases", left, leftWidth, height), panel(this.theme, rightTitle, body, rightWidth, height));
  }

  private renderDetail(termWidth: number, height: number): string[] {
    const phase = this.currentPhase();
    const leftWidth = inspectorLeftWidth(
      termWidth,
      phase.calls.map((call) => call.displayName),
    );
    const rightWidth = termWidth - leftWidth;
    const left = phase.calls.slice(0, height - 2).map((call, index) => {
      const selected = index === this.selectedCall;
      const marker = selected ? this.theme.accent(glyph.marker) : " ";
      let row = `${marker}${callGlyph(call, this.model.tick, this.theme)} ${truncEnd(call.displayName, leftWidth - 5)}`;
      if (selected) row = this.theme.selected(padTo(truncEnd(row, leftWidth - 2), leftWidth - 2));
      return row;
    });
    const rightInner = Math.max(0, rightWidth - 2);
    const doc = this.buildDetailDoc(rightInner);
    const windowHeight = Math.max(1, height - 3);
    this.scroll = clamp(this.scroll, 0, Math.max(0, doc.length - windowHeight));
    const windowLines = doc.slice(this.scroll, this.scroll + windowHeight);
    while (windowLines.length < windowHeight) windowLines.push("");
    windowLines.push(rangeIndicator(this.scroll, windowHeight, doc.length, rightInner, this.theme));
    const call = this.currentCall();
    return joinColumns(
      panel(this.theme, `${phase.name} ${glyph.mid} ${String(phase.calls.length)} calls`, left, leftWidth, height),
      panel(this.theme, call ? call.displayName : phase.name, windowLines, rightWidth, height),
    );
  }

  private buildDetailDoc(innerWidth: number): string[] {
    const call = this.currentCall();
    if (!call) return [this.theme.dim("No call selected.")];
    const lines: string[] = [];
    const push = (line = ""): void => {
      lines.push(truncEnd(line, innerWidth));
    };
    const pushExact = (line = ""): void => {
      for (const wrapped of wrapExactLine(line, innerWidth)) lines.push(wrapped);
    };
    push(`${callGlyph(call, this.model.tick, this.theme)} ${statusWord(call.status)} ${glyph.mid} ${call.model}`);
    const workStats = call.kind === "agent" ? ` ${glyph.mid} ${String(call.toolCalls)} tools ${glyph.mid} ${String(call.steps)} steps` : "";
    push(
      `${this.theme.accent(fmtTokens(call.inputTokens))}${this.theme.dim(
        ` in ${glyph.mid} ${fmtTokens(call.cachedTokens)} cached ${glyph.mid} ${fmtTokens(call.outputTokens)} out ${glyph.mid} `,
      )}${this.theme.warn(fmtCostUsd(call.cost))}${this.theme.dim(` ${workStats} ${glyph.mid} ${fmtDuration(call.durationSeconds, true)}`)}`,
    );
    push("");
    push(this.theme.accent(`Details ${glyph.mid} ${String(call.detailLines.length)} lines`));
    for (const line of call.detailLines) push(`  ${line}`);
    push("");
    const prompt = this.promptExpanded ? readTextArtifact(call.promptPath) : undefined;
    push(
      this.theme.accent(
        `Prompt ${glyph.mid} ${call.promptPath ? "recorded" : "not recorded"} ${glyph.mid} ${glyph.enter} ${this.promptExpanded ? "collapse" : "expand"}`,
      ),
    );
    if (this.promptExpanded) for (const line of (prompt ?? "No prompt artifact recorded.").split("\n")) pushExact(`  ${line}`);
    else
      push(
        this.theme.dim(`  Prompt hidden. Press enter to show the exact prompt sent to this ${call.kind === "llm" ? "LLM call" : "agent"}.`),
      );
    if (call.kind === "agent") {
      push("");
      const toolActivity = readToolActivityArtifact(call.activityPath);
      const recentToolActivity = toolActivity.slice(-3);
      const activityWidth = Math.max(0, Math.min(112, innerWidth - 2));
      push(
        this.theme.accent(`Activity ${glyph.mid} last ${String(recentToolActivity.length)} of ${String(toolActivity.length)} tool uses`),
      );
      for (const line of recentToolActivity) push(`  ${truncEnd(line, activityWidth)}`);
      if (toolActivity.length === 0) push(this.theme.dim("  No tool usage recorded yet."));
    }
    push("");
    push(this.theme.accent("Output"));
    for (const line of callOutput(call).split("\n")) pushExact(`  ${line}`);
    return lines;
  }

  private phases(): WorkflowUiPhase[] {
    return this.model.workflow().phases;
  }

  private currentPhase(): WorkflowUiPhase {
    const phases = this.phases();
    const selectedPhase = clamp(this.selectedPhase, 0, phases.length - 1);
    return phases[selectedPhase] ?? { index: 0, name: "Workflow", status: "pending", callsDone: 0, callsTotal: 0, calls: [] };
  }

  private currentCall(): WorkflowUiCall | undefined {
    const calls = this.currentPhase().calls;
    return calls[clamp(this.selectedCall, 0, calls.length - 1)];
  }
}

function inspectorLeftWidth(termWidth: number, labels: string[]): number {
  const rightMinimum = Math.min(20, Math.max(3, Math.floor(termWidth / 2)));
  const maximum = Math.max(3, Math.min(42, termWidth - rightMinimum));
  const minimum = Math.min(maximum, Math.max(3, Math.floor(termWidth / 3)));
  const desired = Math.max(...labels.map((label) => width(label) + 4), width("Phases") + 4);
  return clamp(desired, minimum, maximum);
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

function callGlyph(call: WorkflowUiCall, tick: number, theme: WorkflowTuiTheme): string {
  if (call.status === "completed") return theme.ok(glyph.done);
  if (call.status === "running") return theme.warn(spinnerFrame(tick));
  return theme.danger("✗");
}

function statusWord(status: WorkflowUiCall["status"]): string {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  return "Failed";
}

function callPreviewRow(call: WorkflowUiCall, rowWidth: number, tick: number, theme: WorkflowTuiTheme): string {
  const toolStats = call.kind === "agent" ? ` ${glyph.mid} ${String(call.toolCalls)} tools` : "";
  const stats = `${fmtTokens(call.inputTokens + call.outputTokens)} tok ${glyph.mid} ${fmtTokens(call.cachedTokens)} cached ${glyph.mid} ${fmtCostUsd(call.cost)}${toolStats} ${glyph.mid} ${fmtDuration(call.durationSeconds)}`;
  const left = `${callGlyph(call, tick, theme)} ${truncEnd(call.displayName, Math.max(8, rowWidth - width(stats) - 14))}  ${theme.dim(call.model)}`;
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

function callOutput(call: WorkflowUiCall): string {
  if (call.error) return call.error;
  if (call.status === "running") return call.kind === "agent" ? (call.message ?? "Agent is still running.") : "LLM call is still running.";
  const text = readTextArtifact(call.outputPath);
  if (text === undefined) return call.outputPath ? `Output artifact unavailable: ${call.outputPath}` : "No output recorded.";
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
