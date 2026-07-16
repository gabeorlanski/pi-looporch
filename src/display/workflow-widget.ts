/** Provides workflow widget behavior. */
import type { Component } from "@earendil-works/pi-tui";
import type { WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import type { WorkflowTuiTheme } from "./workflow-tui-format.ts";
import { fmtCostUsd, fmtDuration, fmtTokens, glyph, padTo, spinnerFrame, truncEnd, width } from "./workflow-tui-format.ts";

/** Provides the WorkflowWidget class contract. */
export class WorkflowWidget implements Component {
  constructor(
    private readonly getModel: () => WorkflowInspectorModel,
    private readonly theme: WorkflowTuiTheme,
    private readonly isArmed: () => boolean,
  ) {}

  invalidate(): void {
    return undefined;
  }

  dispose(): void {
    return undefined;
  }

  render(termWidth: number): string[] {
    const model = this.getModel();
    const workflow = model.workflow();
    const running = workflow.status === "running";
    const armed = this.isArmed();
    const lead = running
      ? this.theme.accent(spinnerFrame(model.tick))
      : workflow.status === "done"
        ? this.theme.ok(glyph.done)
        : this.theme.danger("✗");
    const stats = `${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents done ${glyph.mid} ${fmtDuration(workflow.elapsed)}`;
    const usageLeft = `in ${fmtTokens(workflow.inputTokens)} ${glyph.mid} cached ${fmtTokens(workflow.cachedTokens)}`;
    const usageRight = `out ${fmtTokens(workflow.outputTokens)} ${glyph.mid} ${fmtCostUsd(workflow.cost)}`;
    const gutter = armed ? this.theme.accent(glyph.marker) : " ";
    const namePart = `${gutter} ${lead} ${this.theme.accent(workflow.name)}`;
    const subtitle = this.theme.dim(truncEnd(workflow.subtitle, Math.max(0, termWidth - width(namePart) - 2)));
    let row = padTo(`${namePart}  ${subtitle}`, termWidth);
    let summary = padTo(`   ${this.theme.dim(stats)}`, termWidth);
    let usage = padTo(`   ${this.theme.dim(usageLeft)}`, Math.max(0, termWidth - width(usageRight) - 1)) + this.theme.dim(usageRight);
    if (armed) {
      row = this.theme.selected(row);
      summary = this.theme.selected(summary);
      usage = this.theme.selected(padTo(usage, termWidth));
    }
    const hint = armed
      ? this.theme.dim(`${glyph.enter} open inspector ${glyph.mid} ↑/esc back to prompt`)
      : this.theme.dim(`${glyph.arrowDown} select (on an empty prompt) to inspect`);
    return [padTo(`  ${hint}`, termWidth), row, summary, padTo(usage, termWidth)];
  }
}
