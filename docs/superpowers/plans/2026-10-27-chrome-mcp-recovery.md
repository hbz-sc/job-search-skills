# Chrome MCP Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Locate the real page-read failure, retain the logged-in Chrome tab, and verify one authorized greeting if the site can be read reliably.
**Architecture:** Keep the existing MCP adapter and SQLite runner. Add a single-session diagnostic entry and metadata-only transport observations; use minimal reads before full snapshots. Change site behavior only after observing the actual page.
**Tech Stack:** TypeScript, Node 24, SQLite, installed official Playwright MCP 0.0.83 and Chrome Extension.
**Spec:** docs/superpowers/specs/2026-10-27-chrome-mcp-recovery-design.md

## Global Constraints
- Existing normal Chrome, Default profile; no dedicated browser or model key.
- No automatic reconnection or replay after timeout, no closing user tabs, no cookie/token extraction, no global configuration changes.
- One authorized live greeting at most; first existing template only; stop on quota, verification, identity ambiguity or uncertain send outcome.
- In-place non-Git workspace; retain records instead of committing/creating a worktree.

## Review Focus
- Approval delay must be distinguishable from a hung page read (task 1).
- Duplicate diagnostic entry must not open another connection (task 1).
- Error and event logging must omit tokens, query values and message bodies (task 1).
- Homepage recovery must not choose an unrelated/multiple BOSS tab (task 2).
- A missing lifecycle event must not be reported as proof no navigation/close occurred (task 3).

### Task 1: Single-session staged diagnostic
**Files:** src/mcp/client.ts, src/mcp/probe.ts (new), scripts/mcp-diagnose.mjs (new), tests/mcp-client.test.ts, tests/mcp-probe.test.ts (new).
**Interfaces:** add optional per-call timeout to McpPort.call; add optional metadata event callback to connectTransport/connectMcp. Export diagnose(port,signal,onEvent) returning the completed probe stages. CLI helper uses acquireRunLock and one owned port.
- [ ] Write tests for separate call timeout budgets, no replay after timeout, metadata-only errors, stage ordering and early stop.
- [ ] Run targeted tests; confirm missing behavior fails.
- [ ] Implement request IDs, elapsed time, stage/error categories; a longer authorization timeout only for initial browser_tabs, not all operations. First code probe returns page URL only; next returns a small DOM excerpt; no full snapshot by default. Scope all content probes to the selected BOSS origin and reject ambiguous pages.
- [ ] Run targeted tests/typecheck/build, then one live connection. Keep request and server lifecycle evidence, never raw protocol credentials.

### Task 2: Evidence-led homepage/search and page-read recovery
**Files:** src/browser/mcp-boss-pages.ts, src/browser/mcp-scripts.ts, src/browser/mcp-selectors.ts; tests/mcp-pages.test.ts and fixtures; diagnostic code from task 1 if evidence points to protocol handling.
**Interfaces:** preserve BossPages; add homepage selection and visible search entry only after real UI evidence. Preserve selected tab identity and refuse multiple candidates.
- [ ] Identify minimal failing stage using task 1. Inspect installed MCP and extension implementations for that stage; use localhost control only if needed. Record evidence and hypothesis before a fix.
- [ ] Write a failing regression for the established cause. Add homepage/ambiguous-target tests when that stage becomes reachable.
- [ ] Apply smallest verified fix and run its tests. Instrument authorized page navigation/close/disconnect metadata where reachable; a failed subscription is recorded as unavailable.
- [ ] Re-run the minimal live probe in one connection, then read the actual homepage/search controls and first template. If unavailable, record a concrete external blocker rather than enabling unverified selectors.

### Task 3: Acceptance, documentation and review
**Files:** docs/edge-mcp-acceptance.md, README.md, plan ledger, private diagnostic logs; data only for an actually observed greeting outcome.
**Interfaces:** existing RunAuthorization and runner only after account/template/site contract verified.
- [ ] When current identity, quota state and template are verifiable, search Shenzhen AI应用开发工程师 and perform at most one authorized greeting; verify matching delivered/read text. Otherwise record exact failed stage and stop writes.
- [ ] Run full tests, typecheck and build; separate simulated success from live results. Document URL/lifecycle evidence and uncertainty explicitly.
- [ ] One independent final review of changed files and evidence. Fix important findings with regression tests, no second review cycle.
- [ ] Report actual result and remaining blocker, preserve user pages and the plan ledger.

Self-review: task interfaces preserve existing callers; task 2 depends on evidence, not guessed selectors. No new framework or unrequested batch execution. The existing approval to implement the design and current-session execution method are retained.
