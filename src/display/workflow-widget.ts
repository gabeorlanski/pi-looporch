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
    const usage = `${this.theme.dim("in ")}${this.theme.accent(fmtTokens(workflow.inputTokens))}${this.theme.dim(
      ` ${glyph.mid} cached ${fmtTokens(workflow.cachedTokens)} ${glyph.mid} out ${fmtTokens(workflow.outputTokens)} ${glyph.mid} `,
    )}${this.theme.warn(fmtCostUsd(workflow.cost))}`;
    const gutter = armed ? this.theme.accent(glyph.marker) : this.theme.dim(glyph.arrowDown);
    const namePart = `${gutter} ${lead} ${this.theme.accent(workflow.name)}`;
    const subtitle = this.theme.dim(truncEnd(workflow.subtitle, Math.max(0, termWidth - width(namePart) - 3)));
    const row = padTo(`  ${namePart}  ${subtitle}`, termWidth);
    const metrics = `${stats} ${glyph.mid} ${usage}`;
    const metricRows =
      width(metrics) <= termWidth - 3
        ? [padTo(`   ${this.theme.dim(stats)} ${this.theme.dim(glyph.mid)} ${usage}`, termWidth)]
        : [padTo(`   ${this.theme.dim(stats)}`, termWidth), padTo(`   ${usage}`, termWidth)];
    return [row, ...metricRows].map((line) => (armed ? this.theme.selected(line) : line));
  }
}
