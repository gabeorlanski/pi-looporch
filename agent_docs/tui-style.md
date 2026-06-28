# TUI Style Guide

## Purpose

Use this guide when changing terminal UI, display renderers, progress views, overlays, key handling, or terminal-facing docs. Keep output predictable under narrow widths, non-TTY output, screen readers, logs, tmux, and parallel agent activity.

## Sources

- Pi TUI contracts: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md>, <https://github.com/earendil-works/pi/blob/main/packages/tui/README.md>, <https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts>.
- CLI and terminal behavior: <https://clig.dev/>, <https://nodejs.org/api/tty.html>, <https://no-color.org/>.
- Accessibility: <https://www.w3.org/TR/WCAG22/>.

## Renderer Architecture

- Keep display modules pure: normalized state plus width plus theme in, strings out.
- Keep terminal capability detection at the boundary: TTY, width, color support, plain mode, CI, and script output are not core renderer concerns.
- Prefer compact progress views over verbose live logs. Put transcripts and debug data in files, then show the path.
- Make every visible row meaningful without color. Use text, counters, stable labels, and glyphs before relying on foreground color.
- Keep render output deterministic. Inject or isolate clocks for durations.

## Pi TUI Contracts

- Every rendered line must fit the supplied `width`.
- Use `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`, or equivalent width-aware helpers. Never align, pad, slice, or truncate visible terminal text with raw `string.length`.
- Reapply styles on every rendered line. Pi TUI resets SGR and OSC 8 state at line boundaries.
- Implement `invalidate()` for components that cache render state, even when the current body is empty.
- Components with embedded `Input` or `Editor` children must propagate `Focusable.focused`.
- Do not reuse overlay component instances after close. Recreate overlays for each show/back action.
- Use overlay size, margin, anchor, and `visible` options instead of hand-positioning against assumed terminal sizes.

## Terminal Capability Rules

- Support narrow/default/wide widths explicitly.
- Do not assume Unicode width is one column. ANSI escapes, full-width characters, combining marks, OSC links, and image escapes break naive layout.
- Disable color and animation in non-TTY, `NO_COLOR`, `NODE_DISABLE_COLORS`, `TERM=dumb`, and explicit plain-output modes.
- Avoid F-key and Alt-only controls as primary affordances. Prefer `Esc`, `Ctrl+C`, `Ctrl+\`, arrows, PageUp/PageDown, and Tab.
- Use Pi's `matchesKey(...)`, `Key` constants, and keybinding managers where available instead of manual escape-sequence comparisons.
- Provide an explicit escape path for modal UI and long-running progress screens.

## Progress And Logging

- Default progress should be dense: one status line, phase sections, active children, compact counters, and stable abort/transcript hints.
- Do not interleave parallel child-agent logs into the main progress pane. Show running state in the TUI and persist details in session logs.
- Log terminal-debug details to files while the TUI owns stdout/stderr.
- Prefer stable counters over animated noise: steps, tools, input tokens, output tokens, elapsed time, phase, and current agent label.
- Keep result previews capped. Large content belongs in transcripts, JSONL, or artifact files.

## Testing Checklist

- Test pure renderer output at narrow, default, and wide widths.
- Assert `visibleWidth(line) <= width` for every rendered line.
- Test no-color/plain output separately from themed output.
- Test color is never the only state marker.
- Test input and shortcut behavior through component handlers when the component owns interaction.
- Snapshot only stable frames or pure renderer output.

## Anti-Patterns

- ANSI styling before layout decisions.
- Color-only status like "red means failed".
- Decorative boxes that collapse at narrow widths.
- Hardcoded terminal widths.
- Full-screen animations or spinners in piped/CI output.
- Verbose internal logging to stdout while an interactive TUI is running.
- Adding a new TUI framework just to format a few display strings.
