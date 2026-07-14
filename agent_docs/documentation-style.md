# Documentation Style

> How to write concise, current, technical documentation that helps readers act.

**When to check**: When writing or updating a README, design doc, agent-facing guidance, or API/JSDoc comment.

## Rules

<!-- rule:1 -->

- Open each document or section with the reader task it supports — readers arrive with a goal — leading with the task lets them confirm relevance in seconds instead of parsing background prose first.
<!-- rule:2 -->
- Split content into short sections under task-oriented headings — scannable structure beats a wall of text — readers navigate by scanning headings, so verb-led headings let them jump straight to the part they need.
<!-- rule:3 -->
- Write direct technical prose in active voice with concrete nouns — clarity comes from directness — active voice names the actor and cuts words, so readers grasp who does what without re-reading.
<!-- rule:4 -->
- Use the exact names of commands, APIs, settings, environment variables, and types — precision is non-negotiable in reference docs — an approximate or paraphrased name is unusable and sends readers hunting through source to recover the real one.
<!-- rule:5 -->
- Put commands, signatures, and contracts in fenced code blocks — formatting signals what is literal — code blocks distinguish copy-paste-exact text from prose and preserve whitespace that meaning depends on.
<!-- rule:6 -->
- Keep examples complete enough to run or adapt, including required imports, input shape, and expected output — partial examples fail on first use — a runnable example is verifiable and lets readers confirm they wired it up correctly.
<!-- rule:7 -->
- Show the recommended path rather than every possible option — docs teach the right way — an exhaustive option dump obscures the intended usage and invites readers down dead ends.
<!-- rule:8 -->
- Use absolute dates for any time-sensitive claim — relative time rots — "as of 2026-01" stays meaningful years later while "recently" or "currently" silently becomes false.
<!-- rule:9 -->
- Document contracts, boundary behavior, side effects, errors, and cleanup — that is the information code cannot self-describe — callers need to know what a function guarantees, mutates, and throws before they can use it safely.
<!-- rule:17 -->
- Begin every maintained TypeScript module with one concise JSDoc purpose, and put a leading JSDoc contract on every exported callable declaration — module ownership and API expectations must be visible at the point of use — ESLint enforces both requirements for `extensions/`, `src/`, and `scripts/`.
<!-- rule:10 -->
- Avoid comments that merely restate a name or narrate obvious code — such lines add noise, not information — they waste reader attention, drift out of date, and train readers to ignore comments entirely.
<!-- rule:11 -->
- Update docs in the same change as any behavior, command, setting, or interface change — docs and code must ship together — a doc that lags behavior is worse than none because readers trust and act on it.
<!-- rule:12 -->
- Remove stale compatibility and migration notes once the old path is gone — dead guidance misleads — notes about removed behavior cost reading time and can steer readers toward paths that no longer exist.
<!-- rule:13 -->
- Cite the source file, upstream doc, or durable spec whenever a claim depends on an external contract — claims need provenance — a citation lets readers verify the statement and re-check it when the external contract changes.
<!-- rule:14 -->
- Avoid marketing filler, cheerleading, and unexplained acronyms — technical readers want substance — superlatives and jargon add length without meaning and erode trust in the rest of the document.
<!-- rule:15 -->
- Explain tradeoffs when they affect an implementation choice — decisions need context — stating why one approach was chosen over another helps future maintainers avoid re-litigating or wrongly reversing it.
<!-- rule:16 -->
- Keep durable guidance free of chronological changelog notes and one-off preferences — reference docs describe current state — dated narration and temporary workarounds belong in version control, not in a guide read as ground truth.
