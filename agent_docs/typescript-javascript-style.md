# TypeScript and JavaScript Style

> Rules for writing strict, modern, ESM-first TypeScript and JavaScript for Node, with coercion at boundaries and a strict core.

**When to check**: When writing or modifying any TypeScript/JavaScript source, types, async code, or tests.

## Rules

<!-- rule:1 -->

- Enable strict mode in the compiler and treat it as non-negotiable — strict flags catch nullability and inference gaps early — a lax config lets whole classes of bugs reach runtime where they are far costlier to find.
<!-- rule:2 -->
- Avoid `any`; use `unknown` at untrusted inputs and narrow explicitly before use — `any` disables all type checking silently — a single `any` propagates through call sites and erases the guarantees the rest of the type system provides.
<!-- rule:3 -->
- Model states, result variants, and parse outcomes as discriminated unions — a shared tag lets the compiler enforce exhaustive handling — it makes illegal states unrepresentable and turns forgotten cases into compile errors instead of silent fallthroughs.
<!-- rule:4 -->
- Parse, coerce, normalize, and validate at boundaries (CLI, IO, network, config), keeping core logic strict — boundaries are where untyped data enters — concentrating coercion there means core functions receive already-valid data and never re-check or defensively branch.
<!-- rule:5 -->
- Make core types require what boundaries have already validated instead of leaving fields optional — false optionality forces needless null checks downstream — every unnecessary `?` spreads defensive code and hides the fact that the value is actually guaranteed.
<!-- rule:6 -->
- Use ESM with top-level named exports, reserving default exports for contracts that require them — named exports aid tooling, refactoring, and tree-shaking — they make imports explicit and rename-safe, whereas default exports obscure what a module provides.
<!-- rule:7 -->
- Use `import type` for type-only imports and avoid non-null assertions and broad `as` casts — type-only imports erase cleanly and assertions bypass checking — this keeps runtime output lean and prevents casts from masking genuine type mismatches.
<!-- rule:8 -->
- Prefer literal unions or `as const` maps over `enum` — const-based constructs erase to plain values with no runtime overhead — they stay compatible with erasable-syntax builds and avoid enum's surprising bidirectional and nominal-typing quirks.
<!-- rule:9 -->
- Throw built-in `Error`, `TypeError`, or `RangeError` unless callers genuinely branch on a custom type — the standard hierarchy is universally understood — custom error classes add ceremony that only pays off when code actually discriminates on the error.
<!-- rule:10 -->
- Catch only at boundaries to add context, convert to user-facing messages, or clean up resources — mid-core catches obscure failures — swallowing errors in core logic to keep going produces corrupt state and bugs that surface far from their cause.
<!-- rule:11 -->
- Never silently swallow malformed data or rejected promises; always decide to return or rethrow — a logged-and-ignored error hides real failures — silent swallowing lets invalid state flow onward and makes incidents nearly impossible to diagnose.
<!-- rule:12 -->
- Never guard production invariants with assertions that tooling can strip or that never throw, such as `console.assert` — their behavior varies across runtimes and build steps — checks your program depends on must throw real errors that always execute.
<!-- rule:13 -->
- Always await or return promises and never leave them floating — floating promises drop errors and reorder execution — unhandled rejections can crash the process or corrupt state while the surrounding code races ahead unaware.
<!-- rule:14 -->
- Avoid `forEach` with async callbacks when completion matters; use `for...of` with await or `Promise.all` — `forEach` ignores returned promises — the loop finishes before the async work does, so later code runs against incomplete results.
<!-- rule:15 -->
- Bound fan-out over unbounded collections with batching or a concurrency limit — an unlimited `Promise.all` can exhaust connections, memory, or file handles — capping in-flight work keeps resource use predictable and prevents cascading failures under load.
<!-- rule:16 -->
- Thread an `AbortSignal` through long-running work and release listeners and subscriptions in `finally` — cancellation and cleanup must be deterministic — otherwise cancelled operations keep running and leaked listeners accumulate into memory and lifecycle bugs.
<!-- rule:17 -->
- Prefer built-ins, existing helpers, and deterministic fakes before adding a dependency, and review lockfile changes as code — every dependency is attack surface and maintenance cost — a smaller tree means faster installs, fewer vulnerabilities, and less breakage on upgrades.
<!-- rule:18 -->
- Let the formatter own formatting and the linter and compiler own correctness, keeping tests deterministic and mocking only external deps — separating concerns keeps diffs and signal clean — deterministic tests that avoid mocking core logic catch real regressions instead of flaking or asserting on stubs.
