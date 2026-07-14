/** Provides pi agent capability resolution behavior. */
import type { AgentCapabilityCatalog, AgentCapabilityLoadError, AgentToolOwner, AvailableAgentExtension } from "./pi-agent-capabilities.ts";
import type { CapabilitySelection } from "./workflow/settings.ts";

/** Inputs used to resolve one child agent's extension and tool access. */
export interface ResolveAgentCapabilitiesOptions {
  extensions: unknown;
  tools: unknown;
  catalog: AgentCapabilityCatalog;
}

export type AgentCapabilityDiagnosticCode =
  | "invalid_selection"
  | "invalid_entry"
  | "duplicate_entry"
  | "unknown_extension"
  | "ambiguous_extension"
  | "extension_load_error"
  | "unknown_tool"
  | "ambiguous_tool";

/** Structured capability failure shared by runtime and proposal validation. */
export interface AgentCapabilityResolutionDiagnostic {
  code: AgentCapabilityDiagnosticCode;
  capability: "extensions" | "tools";
  index?: number;
  value?: unknown;
  reason: string;
}

/** Concrete session restrictions, or all structured reasons resolution failed. */
export type ResolvedAgentCapabilities =
  | { ok: true; extensionPaths: string[]; toolNames?: string[] }
  | { ok: false; diagnostics: AgentCapabilityResolutionDiagnostic[] };

/** Shape validation result used before runtime catalog discovery. */
export type ParsedAgentCapabilitySelection =
  | { ok: true; selection: CapabilitySelection }
  | { ok: false; selection?: CapabilitySelection; diagnostics: AgentCapabilityResolutionDiagnostic[] };

/** Resolves exact child extension paths and tool access through one typed authority. */
export function resolveAgentCapabilities(options: ResolveAgentCapabilitiesOptions): ResolvedAgentCapabilities {
  const extensionSelection = parseAgentCapabilitySelection(options.extensions, "extensions");
  const toolSelection = parseAgentCapabilitySelection(options.tools, "tools");
  const diagnostics = [
    ...(extensionSelection.ok ? [] : extensionSelection.diagnostics),
    ...(toolSelection.ok ? [] : toolSelection.diagnostics),
  ];
  if (extensionSelection.selection === undefined || toolSelection.selection === undefined) return { ok: false, diagnostics };
  const extensions = extensionSelection.selection;
  const tools = toolSelection.selection;
  const extensionPaths = new Set<string>();
  if (extensions === "all") {
    for (const extension of options.catalog.availableExtensions) extensionPaths.add(extension.path);
  } else {
    extensions.forEach((selector, index) => {
      const matches = options.catalog.availableExtensions.filter((extension) => extension.identifiers.includes(selector));
      if (matches.length === 0) {
        if (!options.catalog.loadErrors.some((error) => error.selectors?.includes(selector))) {
          diagnostics.push({
            code: "unknown_extension",
            capability: "extensions",
            index,
            value: selector,
            reason: `Unknown extension. Available extensions: ${availableExtensionNames(options.catalog)}.`,
          });
        }
        return;
      }
      if (matches.length > 1) {
        diagnostics.push({
          code: "ambiguous_extension",
          capability: "extensions",
          index,
          value: selector,
          reason: `Ambiguous extension selector. Matches: ${matches.map(extensionDisplayName).join(", ")}.`,
        });
        return;
      }
      extensionPaths.add(matches[0].path);
    });
  }
  appendApplicableLoadErrors(extensions, options.catalog.loadErrors, diagnostics);
  if (tools === "all") {
    const selectedExtensions = options.catalog.availableExtensions.filter((extension) => extensionPaths.has(extension.path));
    appendAmbiguousTools(agentToolOwners({ ...options.catalog, availableExtensions: selectedExtensions }), diagnostics);
    return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, extensionPaths: [...extensionPaths] };
  }

  const ownersByName = agentToolOwners(options.catalog);
  tools.forEach((toolName, index) => {
    const owners = ownersByName.get(toolName) ?? [];
    if (owners.length === 0) {
      diagnostics.push({
        code: "unknown_tool",
        capability: "tools",
        index,
        value: toolName,
        reason: `Unknown tool. Available tools: ${availableToolNames(ownersByName)}.`,
      });
      return;
    }
    if (owners.length > 1) {
      diagnostics.push({
        code: "ambiguous_tool",
        capability: "tools",
        index,
        value: toolName,
        reason: `Ambiguous tool owner. Registered by: ${owners.map(agentToolOwnerDisplayName).join(", ")}.`,
      });
      return;
    }
    const owner = owners[0];
    if (owner.kind === "extension") extensionPaths.add(owner.extension.path);
  });
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, extensionPaths: [...extensionPaths], toolNames: [...tools] };
}

function appendAmbiguousTools(
  ownersByName: ReadonlyMap<string, AgentToolOwner[]>,
  diagnostics: AgentCapabilityResolutionDiagnostic[],
): void {
  for (const [toolName, owners] of ownersByName) {
    if (owners.length < 2) continue;
    diagnostics.push({
      code: "ambiguous_tool",
      capability: "tools",
      value: toolName,
      reason: `Ambiguous tool owner. Registered by: ${owners.map(agentToolOwnerDisplayName).join(", ")}.`,
    });
  }
}

function appendApplicableLoadErrors(
  selection: CapabilitySelection,
  errors: readonly AgentCapabilityLoadError[],
  diagnostics: AgentCapabilityResolutionDiagnostic[],
): void {
  for (const error of errors) {
    const selector = selection === "all" ? undefined : error.selectors?.find((candidate) => selection.includes(candidate));
    if (selection !== "all" && selector === undefined && error.selectors !== undefined) continue;
    if (selection !== "all" && selection.length === 0) continue;
    const index = selector === undefined || selection === "all" ? undefined : selection.indexOf(selector);
    diagnostics.push({
      code: "extension_load_error",
      capability: "extensions",
      ...(index === undefined ? {} : { index }),
      ...(selector === undefined ? {} : { value: selector }),
      reason: `Extension failed to load. ${error.path}: ${error.error}`,
    });
  }
}

function availableExtensionNames(catalog: AgentCapabilityCatalog): string {
  const names = [...new Set(catalog.availableExtensions.flatMap((extension) => extension.identifiers))].sort((left, right) =>
    left.localeCompare(right),
  );
  return names.length > 0 ? names.join(", ") : "none";
}

function extensionDisplayName(extension: AvailableAgentExtension): string {
  return extension.identifiers[0] ?? extension.path;
}

function availableToolNames(owners: ReadonlyMap<string, AgentToolOwner[]>): string {
  const names = [...owners.keys()].sort((left, right) => left.localeCompare(right));
  return names.length > 0 ? names.join(", ") : "none";
}

/** Builds the canonical base, custom, and extension owner list for every available tool name. */
export function agentToolOwners(options: {
  baseToolNames: readonly string[];
  customToolNames?: readonly string[];
  availableExtensions: readonly AvailableAgentExtension[];
}): Map<string, AgentToolOwner[]> {
  const owners = new Map<string, AgentToolOwner[]>();
  const add = (name: string, owner: AgentToolOwner): void => {
    owners.set(name, [...(owners.get(name) ?? []), owner]);
  };
  for (const name of new Set(options.baseToolNames)) add(name, { kind: "base" });
  options.customToolNames?.forEach((name, index) => add(name, { kind: "custom", index }));
  for (const extension of options.availableExtensions) {
    for (const name of new Set(extension.toolNames)) add(name, { kind: "extension", extension });
  }
  return owners;
}

/** Renders a stable user-facing identity for one child-agent tool owner. */
export function agentToolOwnerDisplayName(owner: AgentToolOwner): string {
  if (owner.kind === "base") return "Pi base tools";
  if (owner.kind === "custom") return `custom tool #${String(owner.index + 1)}`;
  return owner.extension.identifiers[0] ?? owner.extension.path;
}

/** Validates and normalizes one dynamic capability selection without throwing or loading resources. */
export function parseAgentCapabilitySelection(selection: unknown, capability: "extensions" | "tools"): ParsedAgentCapabilitySelection {
  if (selection === "all") return { ok: true, selection };
  if (!Array.isArray(selection)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "invalid_selection",
          capability,
          value: selection,
          reason: `Capability selection must be "all" or an array of unique, non-empty strings.`,
        },
      ],
    };
  }
  const normalized: string[] = [];
  const diagnostics: AgentCapabilityResolutionDiagnostic[] = [];
  selection.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      diagnostics.push({
        code: "invalid_entry",
        capability,
        index,
        value: entry,
        reason: "Capability entries must be non-empty strings.",
      });
      return;
    }
    const value = entry.trim();
    if (normalized.includes(value)) {
      diagnostics.push({ code: "duplicate_entry", capability, index, value, reason: "Duplicate capability entry." });
      return;
    }
    normalized.push(value);
  });
  return diagnostics.length > 0 ? { ok: false, selection: normalized, diagnostics } : { ok: true, selection: normalized };
}
