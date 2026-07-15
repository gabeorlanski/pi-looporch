/** Provides workflow widget behavior. */
import type { Component } from "@earendil-works/pi-tui";
import type { WorkflowInspectorModel } from "./workflow-inspector-model.ts";
import type { WorkflowTuiTheme } from "./workflow-tui-format.ts";
import { fmtDuration, fmtTokens, glyph, padTo, spinnerFrame, truncEnd, width } from "./workflow-tui-format.ts";

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
    const stats = [
      `${String(workflow.agentsDone)}/${String(workflow.agentsTotal)} agents done`,
      fmtDuration(workflow.elapsed),
      `${glyph.arrowDown}${fmtTokens(workflow.tokensTotal)} tokens`,
    ].join(` ${glyph.mid} `);
    const gutter = armed ? this.theme.accent(glyph.marker) : " ";
    const namePart = `${lead} ${this.theme.accent(workflow.name)}`;
    const fixed = width(`${glyph.marker} ${lead} ${workflow.name}  `) + width(stats) + 2;
    const subtitle = this.theme.dim(truncEnd(workflow.subtitle, Math.max(0, termWidth - fixed)));
    const left = `${gutter} ${namePart}  ${subtitle}`;
    let row = padTo(left, Math.max(0, termWidth - width(stats) - 1)) + this.theme.dim(stats) + " ";
    if (armed) row = this.theme.selected(padTo(row, termWidth));
    const hint = armed
      ? this.theme.dim(`${glyph.enter} open inspector ${glyph.mid} ↑/esc back to prompt`)
      : this.theme.dim(`${glyph.arrowDown} select (on an empty prompt) to inspect`);
    return [padTo(`  ${hint}`, termWidth), padTo(row, termWidth)];
  }
}
