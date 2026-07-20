# src/pi-agent/capabilities/ Agent Instructions

## Purpose

`src/pi-agent/capabilities/` owns child-agent capability discovery and exact
extension/tool access resolution.

## Files

- `catalog.ts`: Pi extension discovery and capability catalog construction.
- `resolution.ts`: typed selection validation and exact access resolution.

Import symbols from the module that owns them. Do not add barrel exports: catalog
discovery and access resolution have separate dependencies. See `../AGENTS.md`.
