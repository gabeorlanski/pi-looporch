# TypeScript And JavaScript Style Guide

## Purpose

Use this guide for TypeScript, JavaScript, Node, and test changes. The default is strict, dependency-light, ESM-first code with coercion at boundaries.

## Sources

- TypeScript: <https://www.typescriptlang.org/docs/>, <https://www.typescriptlang.org/tsconfig/>.
- Linting: <https://typescript-eslint.io/getting-started/typed-linting/>, <https://typescript-eslint.io/users/configs/>.
- Node and JavaScript: <https://nodejs.org/api/errors.html>, <https://nodejs.org/api/globals.html>, <https://nodejs.org/api/test.html>, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import>.
- Pi upstream rules: <https://github.com/earendil-works/pi/blob/main/AGENTS.md>.

## Modules And Dependencies

- Use ESM imports and exports. Keep imports top-level.
- Prefer named exports in ordinary source modules. Use default exports only where the public contract requires them, such as generated `workflow.js` files.
- Prefer Node built-ins, TypeScript, existing helpers, and deterministic fakes before adding packages.
- Treat package and lockfile changes as reviewed code.
- Do not introduce mutable exported singleton state unless the module is explicitly a process boundary or adapter.

## Types

- Keep `strict` non-negotiable.
- Avoid `any`. Use `unknown` at untrusted boundaries and narrow explicitly.
- Prefer exported `interface` declarations for object-shaped public contracts. Use `type` for unions, literals, tuples, mapped/conditional types, and aliases.
- Use discriminated unions for states, result variants, parse outcomes, and verifier decisions.
- Avoid false optionality. Once a boundary has validated a value, core types should make it required.
- Prefer literal unions or `as const` maps over `enum`; upstream Pi source favors erasable TypeScript syntax.
- Avoid non-null assertions and broad `as` assertions.
- Use `import type` for type-only imports.

## Boundaries

- Parse, coerce, normalize, and validate at CLI, TUI, file IO, API, tool, config, and SDK boundaries.
- Keep core runtime logic strict: no hidden string/path coercion, optional inputs, provider construction, or environment reads.
- Inject external dependencies such as agents, reviewers, sessions, resource loaders, clocks, and filesystem roots.
- Throw actionable errors at boundaries when user input or project config is invalid.

## Errors

- Use `Error`, `TypeError`, or `RangeError` unless callers genuinely branch on a custom domain error.
- Catch at boundaries to add context, convert to user-facing messages, or clean up resources.
- Do not catch in core logic just to continue.
- Do not silently swallow malformed internal data.
- Do not use `assert` for runtime invariants that must survive optimized execution.

## Async And Concurrency

- Always return or await promises. No floating promises.
- Do not use `forEach(async ...)` when completion matters.
- Use `Promise.all` for all-or-nothing work and `Promise.allSettled` when every result matters.
- Bound fan-out over project-sized collections. Queue or batch when work can launch agents, tools, processes, or file writes.
- Thread `AbortSignal` through long-running work. Clean up listeners in `finally`.
- Keep session and subscription lifecycle explicit: unsubscribe and dispose in `finally`.

## Tests

- Use deterministic fakes for agents, reviewers, sessions, clocks, and external IO.
- Mock only slow, flaky, external, or process-bound dependencies. Do not mock core logic.
- Prefer focused behavior tests over broad snapshots.
- Test error messages when they are part of the contract.
- In this repo, use `node:test` through `npm test`/`tsx --test`; run `npm run check` before handoff after code changes.

## Linting And Formatting

- Let Prettier own formatting.
- Let ESLint and TypeScript own correctness and static hazards.
- Inline disables must name the exact rule and include a short reason.
- Keep `@typescript-eslint/no-floating-promises`, `no-explicit-any`, `consistent-type-imports`, `no-unnecessary-condition`, and nullish handling clean.

## Anti-Patterns

- `any`, double assertions, and non-null assertions as convenience.
- Optional fields in core types because boundary parsing was skipped.
- Dynamic imports or inline type imports in normal source.
- Hidden provider/session construction inside business logic.
- Broad `catch`, swallowed rejection, or logging without a return/throw decision.
- Unbounded `Promise.all` over user/project-sized collections.
- Default exports in ordinary modules.
- Tests that call real models or live Pi sessions.
