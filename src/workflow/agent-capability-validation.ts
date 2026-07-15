/** Provides agent capability validation behavior. */
import * as ts from "typescript";
import type { AgentCapabilityCatalog, AgentCapabilityCatalogProvider } from "../pi-agent-capabilities.ts";
import { resolveAgentCapabilities } from "../pi-agent-capabilities.ts";
import { collectWorkflowAgentCapabilityUses, type CapabilityDiagnostic, type CapabilityUse } from "./agent-capability-source.ts";
import type { CapabilitySelection } from "./settings.ts";

/** Inputs required to validate workflow child-agent capabilities before publishing a draft. */
export interface ValidateWorkflowAgentCapabilitiesOptions {
  source: string;
  workflowName: string;
  defaultExtensions: CapabilitySelection;
  defaultTools: CapabilitySelection;
  catalogProvider: AgentCapabilityCatalogProvider;
}

/** Validates all statically identifiable child-agent capability selections in generated workflow source. */
export async function validateWorkflowAgentCapabilities(options: ValidateWorkflowAgentCapabilitiesOptions): Promise<void> {
  const sourceFile = ts.createSourceFile("workflow.js", options.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics: CapabilityDiagnostic[] = [];
  const uses = collectWorkflowAgentCapabilityUses(sourceFile, options.defaultExtensions, options.defaultTools, diagnostics);
  if (uses.length === 0 && diagnostics.length === 0) return;
  if (
    uses.every(
      (use) =>
        use.extensions.kind === "list" && use.extensions.values.length === 0 && use.tools.kind === "list" && use.tools.values.length === 0,
    )
  ) {
    if (diagnostics.length > 0) throw new Error(renderCapabilityDiagnostics(options.workflowName, sourceFile, diagnostics));
    return;
  }

  const extensionSelectors = uses.flatMap((use) => (use.extensions.kind === "list" ? use.extensions.values : []));
  const catalog = await options.catalogProvider({ extensionSelectors });
  for (const use of uses) validateCapabilityUse(use, catalog, diagnostics);
  if (diagnostics.length > 0) throw new Error(renderCapabilityDiagnostics(options.workflowName, sourceFile, diagnostics));
}

function validateCapabilityUse(use: CapabilityUse, catalog: AgentCapabilityCatalog, diagnostics: CapabilityDiagnostic[]): void {
  if (use.extensions.kind === "invalid" || use.tools.kind === "invalid") return;
  const resolved = resolveAgentCapabilities({
    extensions: use.extensions.kind === "all" ? "all" : use.extensions.values,
    tools: use.tools.kind === "all" ? "all" : use.tools.values,
    catalog,
  });
  if (resolved.ok) return;
  for (const diagnostic of resolved.diagnostics) {
    const value = use[diagnostic.capability];
    diagnostics.push({
      node: diagnostic.index === undefined || value.kind !== "list" ? value.node : (value.entries[diagnostic.index]?.node ?? value.node),
      primitive: use.primitive,
      capability: diagnostic.capability,
      ...(diagnostic.index === undefined ? {} : { index: diagnostic.index }),
      ...(diagnostic.value === undefined ? {} : { value: diagnostic.value }),
      reason: diagnostic.reason,
    });
  }
}

function renderCapabilityDiagnostics(workflowName: string, sourceFile: ts.SourceFile, diagnostics: CapabilityDiagnostic[]): string {
  const rendered = diagnostics.map((diagnostic) => {
    const location = sourceFile.getLineAndCharacterOfPosition(Math.max(0, diagnostic.node.getStart(sourceFile)));
    const target =
      diagnostic.capability === "invocation"
        ? `${diagnostic.primitive} invocation`
        : `${diagnostic.primitive} ${diagnostic.capability}${diagnostic.index === undefined ? "" : `[${String(diagnostic.index)}]`}`;
    const value = diagnostic.value === undefined ? "" : ` ${JSON.stringify(diagnostic.value)}`;
    return `- workflow.js:${String(location.line + 1)}:${String(location.character + 1)} ${target}${value}: ${diagnostic.reason}`;
  });
  return [
    `propose_workflow rejected workflow '${workflowName}': invalid child-agent capabilities`,
    "",
    ...rendered,
    "",
    "No workflow files were saved.",
  ].join("\n");
}
