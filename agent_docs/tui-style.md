# Terminal UI Style

> Rules for rendering predictable terminal output across varying widths, non-TTY sinks, color-off environments, and concurrent agent activity.

**When to check**: When changing terminal rendering, progress views, overlays, key handling, or color/width behavior.

## Rules

<!-- rule:1 -->

- Keep renderers pure functions of state, width, and theme that return strings — isolates layout logic from side effects — pure renderers are trivially testable, snapshot-able, and reusable across contexts without a live terminal.
<!-- rule:2 -->
- Detect terminal capabilities only at the boundary and pass results inward — keeps core rendering free of environment probing — centralizing TTY, width, and color checks prevents scattered conditionals and lets renderers stay deterministic.
<!-- rule:3 -->
- Measure text with a width-aware helper, never with string length — code points are not display columns — ANSI escapes, full-width CJK characters, combining marks, and hyperlink sequences make naive length counts misalign, overflow, or truncate mid-glyph.
<!-- rule:4 -->
- Ensure every rendered line fits the supplied width before emitting it — overflow corrupts layout in wrapped and multiplexed terminals — a single too-long line breaks column alignment and pushes content off-screen or into unintended wraps.
<!-- rule:5 -->
- Reapply styles on every line rather than assuming they carry over — many renderers reset color and link state at line boundaries — relying on bleed-through produces uncolored or mis-styled lines when output is chunked, scrolled, or partially redrawn.
<!-- rule:6 -->
- Respect NO_COLOR, non-TTY output, and dumb terminals by disabling color and animation — these signal that escape codes are unwanted or unsupported — emitting them anyway litters logs, pipes, and CI output with unreadable control sequences.
<!-- rule:7 -->
- Never use color as the only carrier of state — color is invisible to colorblind users, screen readers, and monochrome sinks — pairing every status with text, glyphs, or labels keeps meaning intact when color is stripped or unseen.
<!-- rule:8 -->
- Prefer compact progress views over verbose live logs on the interactive surface — dense status is scannable and stable — streaming full logs into the view causes flicker, scrollback churn, and buries the current state.
<!-- rule:9 -->
- Write transcripts and debug detail to files and show their paths instead of the content — keeps the live view uncluttered — persisted artifacts are searchable, diffable, and survive after the session ends, unlike ephemeral terminal output.
<!-- rule:10 -->
- Inject clocks and other nondeterministic inputs so render output is reproducible — durations and timestamps otherwise vary per run — deterministic output makes snapshot tests stable and lets you diff frames meaningfully.
<!-- rule:11 -->
- Avoid adding keybindings unless an interactive control surface was explicitly requested — unexpected key capture surprises users and conflicts with terminal or multiplexer shortcuts — passive output composes cleanly with pipes, logs, and parallel processes.
<!-- rule:12 -->
- Keep concurrent agent or child-process logs out of the main progress pane — interleaved streams are unreadable and nondeterministic — showing only summarized running state while persisting per-source detail keeps the view coherent under parallelism.
<!-- rule:13 -->
- Prefer stable counters and labels over animated spinners in non-interactive output — animation frames become garbage when piped or captured — steady numeric progress conveys the same information without escape-sequence noise in logs and CI.
<!-- rule:14 -->
- Make layout decisions before applying styling — styling first entangles measurement with presentation — computing widths on plain text and adding color last keeps alignment correct and rendering logic separable.
<!-- rule:15 -->
- Support narrow, default, and wide widths explicitly rather than hardcoding a size — real terminals span a wide range and resize live — designs that assume a fixed width collapse boxes, wrap awkwardly, or clip content on other displays.
<!-- rule:16 -->
- Test renderer output at narrow, default, and wide widths, asserting each line fits — width bugs surface only at the extremes — covering the boundaries catches truncation and overflow that a single default-width test misses.
<!-- rule:17 -->
- Test color-off and plain output paths separately from themed output — the two paths diverge and regress independently — dedicated assertions guarantee state stays legible when color is disabled or the sink is non-interactive.
<!-- rule:18 -->
- Avoid introducing a new UI framework merely to format a few strings — heavy dependencies add build weight and lock-in — plain width-aware string helpers cover simple output without the maintenance cost of a full rendering stack.
<!-- rule:19 -->
- Keep result content out of compact live widgets, but show bounded final result/report previews in completion messages — live progress stays scannable while completed workflows still surface the answer without forcing a second user prompt.
