# Python LangGraph Minimal Loop Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** Migrate the primary JobPilot business workflow to Python LangGraph and provide a small runnable teaching loop.
**Architecture:** Python StateGraph with5ordinary nodes and conditional routing; injected planner/browser/ledger. Demo uses fixtures and isolated DB; live modes use existing MCP bridge and shared safety history. JS extension remains tool layer.
**Tech Stack:** Python3.12, LangGraph, MCP Python SDK, HTTPX, SQLite, unittest.
**Spec:** docs/superpowers/specs/2026-11-02-python-langgraph-minimal.md

## Global Constraints
- Python is the actual orchestrator; no Node subprocess for business flow.
- Shenzhen/1–3+3–5 only; manual experience selection unchanged.
- Live run max1 contact, exact saved phrase, no automatic resend or history deletion.
- Demo must work without model/network/browser and never touch real contact history.
- Existing no-Git in-place authorization; no commits/worktree cleanup.

## Review Focus
1. Demo and preview cannot call real send or reserve real contact.
2. Unknown opening/sending outcomes remain deduplicated across restarts.
3. Fresh query/identity/phrase guards must precede contacting.
4. Model/transport failures cannot leak API tokens or resume into logs.
5. Python and old TS run entrypoints cannot concurrently mutate contact state.

### Task1: Python graph and offline learning loop
- [x] Write failing tests for node order, preview/no candidate branches and failure recording.
- [x] Implement graph, TypedDict, demo tool, CLI and teaching example; install isolated dependencies.
- [x] Run demo and tests, explain State/Node/Edge and conditional routing.

### Task2: Model, real tool adapter and shared ledger
- [x] Add failing tests for role validation, native request correlation, single-send reservation/dedup and unknown outcomes.
- [x] Implement OpenAI-compatible planner, direct Python MCP adapter, SQLite history, single-contact execution and locking.
- [x] Verify fake transport integration, model call if configured, and read-only live readiness where available.

### Task3: Primary entry, documentation and final review
- [x] Switch documented/default JobPilot entry to Python; retain TS explicitly as legacy.
- [x] Write learning walkthrough, setup/run examples and honest migration limits.
- [x] One fresh review, fix important findings, run final Python suite and relevant launcher checks.
