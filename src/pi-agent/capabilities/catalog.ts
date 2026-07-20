/** Provides pi agent capabilities behavior. */
import {
  createCodingTools,
  createReadOnlyTools,
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
  type ResolvedResource,
  type ToolDefinition,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";

/** One loaded Pi extension and the tool names registered by its factory. */
export interface AvailableAgentExtension {
  identifiers: string[];
  path: string;
  toolNames: string[];
}

/** Loaded extension and tool metadata used for proposal-time capability validation. */
export interface AgentCapabilityCatalog {
  availableExtensions: AvailableAgentExtension[];
  baseToolNames: string[];
  customToolNames?: string[];
  loadErrors: AgentCapabilityLoadError[];
}

/** One extension load failure and any explicit selectors that resolved to its path. */
export interface AgentCapabilityLoadError {
  path: string;
  error: string;
  selectors?: string[];
}

/** Canonical owner of one tool name available to a child agent. */
export type AgentToolOwner =
  | { kind: "base" }
  | { kind: "custom"; index: number }
  | { kind: "extension"; extension: AvailableAgentExtension };

/** Requested extension selectors needed while building a proposal-time capability catalog. */
export interface AgentCapabilityCatalogRequest {
  extensionSelectors: string[];
}

/** Resolved extension files and their original workflow selectors. */
export interface ResolvedAgentExtensionSelectors {
  paths: string[];
  selectorsByPath: Map<string, string[]>;
}

/** Injectable catalog boundary used by proposal validation and deterministic tests. */
export type AgentCapabilityCatalogProvider = (request: AgentCapabilityCatalogRequest) => Promise<AgentCapabilityCatalog>;

/** Builds capability metadata from the already-bound parent session without re-running extension factories. */
export function createParentAgentCapabilityCatalogProvider(options: {
  cwd: string;
  agentDir?: string;
  getTools: () => ToolInfo[];
}): AgentCapabilityCatalogProvider {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(options.cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd: options.cwd, agentDir, settingsManager });
  let configuredExtensions: Promise<ResolvedResource[]> | undefined;
  return async (request) => {
    configuredExtensions ??= packageManager.resolve().then((resolved) => resolved.extensions.filter((extension) => extension.enabled));
    const explicit = await resolveAgentExtensionSelectors({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      selectors: request.extensionSelectors,
    });
    const resources = mergeExtensionResources(await configuredExtensions, explicit);
    const parentTools = options.getTools();
    const boundExtensionPaths = new Set(
      parentTools
        .filter((tool) => tool.sourceInfo.source !== "builtin" && tool.sourceInfo.source !== "sdk")
        .map((tool) => tool.sourceInfo.path),
    );
    const unboundExplicitPaths = explicit.paths.filter((extensionPath) => !boundExtensionPaths.has(extensionPath));
    if (unboundExplicitPaths.length === 0) return catalogFromParentTools(parentTools, resources);

    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      additionalExtensionPaths: unboundExplicitPaths,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    const parentCatalog = catalogFromParentTools(parentTools, resources);
    return buildAgentCapabilityCatalog({
      ...parentCatalog,
      availableExtensions: mergeAvailableAgentExtensions(
        parentCatalog.availableExtensions,
        availableAgentExtensions(loaded.extensions, explicit.selectorsByPath),
      ),
      loadErrors: loaded.errors.map((error) => ({
        ...error,
        selectors: selectorsForExtensionPath(error.path, explicit.selectorsByPath),
      })),
    });
  };
}

function mergeAvailableAgentExtensions(
  first: readonly AvailableAgentExtension[],
  second: readonly AvailableAgentExtension[],
): AvailableAgentExtension[] {
  const merged = new Map(first.map((extension) => [extension.path, extension]));
  for (const extension of second) {
    const existing = merged.get(extension.path);
    merged.set(
      extension.path,
      existing
        ? {
            identifiers: [...existing.identifiers, ...extension.identifiers],
            path: extension.path,
            toolNames: [...existing.toolNames, ...extension.toolNames],
          }
        : extension,
    );
  }
  return [...merged.values()];
}

function mergeExtensionResources(configured: readonly ResolvedResource[], explicit: ResolvedAgentExtensionSelectors): ResolvedResource[] {
  const resources = new Map(configured.map((extension) => [extension.path, extension]));
  for (const extensionPath of explicit.paths) {
    const selectors = explicit.selectorsByPath.get(extensionPath) ?? [];
    resources.set(extensionPath, {
      path: extensionPath,
      enabled: true,
      metadata: { source: selectors[0] ?? extensionPath, scope: "temporary", origin: "top-level" },
    });
  }
  return [...resources.values()];
}

function catalogFromParentTools(tools: readonly ToolInfo[], resources: readonly ResolvedResource[]): AgentCapabilityCatalog {
  const baseToolNames: string[] = [];
  const customToolNames: string[] = [];
  const extensionTools = new Map<string, string[]>();
  for (const tool of tools) {
    if (tool.sourceInfo.source === "builtin") {
      baseToolNames.push(tool.name);
    } else if (tool.sourceInfo.source === "sdk") {
      customToolNames.push(tool.name);
    } else {
      extensionTools.set(tool.sourceInfo.path, [...(extensionTools.get(tool.sourceInfo.path) ?? []), tool.name]);
    }
  }
  const resourceByPath = new Map(resources.map((resource) => [resource.path, resource]));
  for (const extensionPath of extensionTools.keys()) {
    if (resourceByPath.has(extensionPath)) continue;
    resourceByPath.set(extensionPath, {
      path: extensionPath,
      enabled: true,
      metadata: { source: "auto", scope: "project", origin: "top-level" },
    });
  }
  return buildAgentCapabilityCatalog({
    availableExtensions: [...resourceByPath.values()].map((resource) => ({
      identifiers: [
        resource.path,
        ...(resource.metadata.source === "auto" || resource.metadata.source === "cli" ? [] : [resource.metadata.source]),
      ],
      path: resource.path,
      toolNames: [...new Set(extensionTools.get(resource.path) ?? [])],
    })),
    baseToolNames: [...new Set(baseToolNames)],
    customToolNames: [...new Set(customToolNames)],
    loadErrors: [],
  });
}

/** Normalizes the single catalog shape consumed by parent, loader, runtime, and proposal paths. */
export function buildAgentCapabilityCatalog(catalog: AgentCapabilityCatalog): AgentCapabilityCatalog {
  return {
    availableExtensions: catalog.availableExtensions.map((extension) => ({
      identifiers: [...new Set(extension.identifiers)],
      path: extension.path,
      toolNames: [...new Set(extension.toolNames)],
    })),
    baseToolNames: [...new Set(catalog.baseToolNames)],
    customToolNames: [...new Set(catalog.customToolNames ?? [])],
    loadErrors: [
      ...new Map(
        catalog.loadErrors.map((error) => [
          `${error.path}\0${error.error}`,
          { ...error, ...(error.selectors ? { selectors: [...new Set(error.selectors)] } : {}) },
        ]),
      ).values(),
    ],
  };
}

/** Builds authoritative proposal-time capability metadata with Pi's real extension loader and tool factories. */
export function createAgentCapabilityCatalogProvider(options: {
  cwd: string;
  agentDir?: string;
  customTools?: ToolDefinition[];
}): AgentCapabilityCatalogProvider {
  return async (request) => {
    const agentDir = options.agentDir ?? getAgentDir();
    const settingsManager = SettingsManager.create(options.cwd, agentDir);
    const resolvedSelectors = await resolveAgentExtensionSelectors({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      selectors: request.extensionSelectors,
    });
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      settingsManager,
      additionalExtensionPaths: resolvedSelectors.paths,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    return buildAgentCapabilityCatalog({
      availableExtensions: availableAgentExtensions(loaded.extensions, resolvedSelectors.selectorsByPath),
      baseToolNames: availableBaseAgentToolNames(options.cwd),
      customToolNames: (options.customTools ?? []).map((tool) => tool.name),
      loadErrors: [
        ...new Map(
          loaded.errors.map((error) => [
            `${error.path}\0${error.error}`,
            { ...error, selectors: selectorsForExtensionPath(error.path, resolvedSelectors.selectorsByPath) },
          ]),
        ).values(),
      ],
    });
  };
}

/** Enumerates Pi's built-in child-agent tools at the normalized SDK boundary. */
export function availableBaseAgentToolNames(cwd: string): string[] {
  const tools = [...(createCodingTools(cwd) as ToolDefinition[]), ...(createReadOnlyTools(cwd) as ToolDefinition[])];
  return [...new Set(tools.map((tool) => tool.name))];
}

function selectorsForExtensionPath(errorPath: string, selectorsByPath: ReadonlyMap<string, readonly string[]>): string[] {
  for (const [extensionPath, selectors] of selectorsByPath) {
    if (extensionPath === errorPath) return [...selectors];
  }
  return [];
}

/** Resolves extension selectors through Pi's package manager without initializing extension factories. */
export async function resolveAgentExtensionSelectors(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  selectors: readonly string[];
}): Promise<ResolvedAgentExtensionSelectors> {
  const selectors = [...new Set(options.selectors)];
  if (selectors.length === 0) return { paths: [], selectorsByPath: new Map() };
  const resolved = await new DefaultPackageManager({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
  }).resolveExtensionSources(selectors, { temporary: true });
  const selectorsByPath = new Map<string, string[]>();
  for (const extension of resolved.extensions) {
    if (!extension.enabled) continue;
    const selected = selectorsByPath.get(extension.path) ?? [];
    selectorsByPath.set(extension.path, [...new Set([...selected, extension.metadata.source])]);
  }
  return { paths: [...selectorsByPath.keys()], selectorsByPath };
}

/** Loaded Pi extension fields used to derive stable capability metadata. */
export interface LoadedAgentExtension {
  path: string;
  resolvedPath: string;
  sourceInfo: { path: string; source: string };
  tools: ReadonlyMap<string, unknown>;
}

/** Builds a child-agent extension catalog from Pi's loaded extension factories. */
export function availableAgentExtensions(
  extensions: LoadedAgentExtension[],
  selectorsByPath: ReadonlyMap<string, readonly string[]> = new Map(),
): AvailableAgentExtension[] {
  return extensions.map((extension) => ({
    identifiers: [
      ...new Set([
        extension.path,
        extension.resolvedPath,
        extension.sourceInfo.path,
        ...(extension.sourceInfo.source === "auto" || extension.sourceInfo.source === "cli" ? [] : [extension.sourceInfo.source]),
        ...(selectorsByPath.get(extension.resolvedPath) ?? []),
      ]),
    ],
    path: extension.resolvedPath,
    toolNames: [...extension.tools.keys()],
  }));
}
