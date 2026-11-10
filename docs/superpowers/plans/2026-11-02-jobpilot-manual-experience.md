# Manual Experience Handoff Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** Preserve manual experience selections and continue the LangGraph search/contact workflow using only1–3/3–5year candidates.
**Architecture:** Fixed DOM reads select candidates from the manual multi-select; existing v3 graph, schemas, ledger and send actions stay in place. No new browser command surface.
**Tech Stack:** TypeScript, extension JavaScript, LangGraph, SQLite, Vitest/Edge fixtures.
**Spec:** docs/superpowers/specs/2026-11-02-jobpilot-manual-experience.md

## Global Constraints
- Manual filters are never automatically changed.
- No5–10year contact; first live contact budget1, phrase hash frozen.
- Existing no-Git in-place authorization retained; no commits/worktree deletion.
- Keep unknown-send history and single-dispatch protection.

## Review Focus
1. Missing manual band pauses without input.
2. Mixed-band page returns only the requested permitted band.
3. Changing experience while waiting for click authorization cannot contact the old candidate.
4. Keyword transitions cannot accept an unchanged raw result list.
5. Chat return preserves filters and fixed phrase guards.

### Task1: Manual filtering and target guards
- [x] Add failing real-markup browser tests for mixed bands, missing selection, no pointer/click delegation and late target changes.
- [x] Implement fixed manual reads, v3 no-filter-mutation behavior and fresh job-band checks at open_job/open_chat.
- [x] Run affected suites, typecheck and build.

### Task2: Verify and deliver
- [ ] Run full suite and one fresh final review; fix important findings with regressions.
- [ ] Build0.6.0, document manual workflow and captured first template, compare published local artifact hashes.
- [ ] Live zero-contact preview, then at most1contact once all current conditions verify; report evidence and remaining blockers.
