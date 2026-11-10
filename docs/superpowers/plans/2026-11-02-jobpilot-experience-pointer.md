# Experience Pointer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Use browser-level input to open and select the fixed BOSS experience filter, with observed postconditions and no messages during acceptance.
**Architecture:** Content code returns bounded geometry/selection evidence for the experience control. A dedicated background executor owns a short-lived debugger attachment and sends only fixed Input mouse events. The existing v3 search workflow invokes it and retains existing filter/result verification and business budgets.
**Tech Stack:** Existing JavaScript extension, TypeScript/Vitest, Playwright local Edge fixtures, LangGraph and Python bridge unchanged.
**Spec:** docs/superpowers/specs/2026-11-02-jobpilot-experience-pointer-design.md

## Global Constraints

- Only current bound top-level https://www.zhipin.com/web/geek/jobs document; existing v3 search_jobs / restore_search scopes and deadlines.
- Required debugger permission, not optional; no arbitrary CDP/selectors/coordinates in MCP, no cookies/network reads or new browser process.
- No contact during acceptance; preserve historical unknown sends and current first-phrase requirement.
- User confirmed design and inline implementation. Continue without another planning approval; request browser permission only for concrete tested update at activation.
- Existing no-Git workspace: in-place edits, no Git initialization/commits, retain ledgers and backups.

## Review Focus

1. Cancel or timeout while attach is pending: late success cannot produce input; detach own late attachment.
2. Movement or overlay between pointer movement and press: remeasure/hit-test; no stale click.
3. Document replacement during click or release failure: no subsequent selection, release own held button outside content and detach.
4. Other debugger or policy denial: do not detach another owner or retry to steal control.
5. Error reporting across native result reconciliation: preserve explicit filter/debugger failure codes without making unknown sends replayable.

### Task 1: Fixed DOM geometry and pointer lifecycle

**Files:** create extensions/boss-page/experience-pointer.js, extensions/boss-page/experience-dom.js; tests/boss-experience-pointer.test.ts, tests/boss-experience-dom.test.ts.
**Interfaces:** `experiencePointerView(doc, query, state, beforeEffect)` returns bounded control/option geometry, menu visibility and selection evidence; state selects only control/option/selection/scroll operations and fixed labels. `ExperiencePointer.select({binding,deadline,check,observe})` uses injected async checks and DOM reads, owns attachment and cleanup; `cancel(reason)` invalidates it.
- [x] Write failing tests for real CSS-hover fixture, both bands, offscreen/covered/ambiguous controls, semantic multiselect and fresh geometry; mock browser debugger only for lifecycle race tests named in Review Focus1–4.
- [x] Run `boss.cmd test tests/boss-experience-pointer.test.ts tests/boss-experience-dom.test.ts`; observe expected missing behavior failures.
- [x] Implement fixed DOM evidence and dedicated bounded executor. Backend requests/validates points from fixed DOM helper; input is CSS viewport coordinates. Allow one menu re-open; require a changed selection before another click; finally cleanup own attachment and pressed input. No generic action transport.
- [x] Run targeted tests GREEN, including headless Edge CDP input against CSS-hover fixture; record results.

### Task 2: Workflow integration, authority and error evidence

**Files:** modify content.js, search-actions.js, search-filters.js, workflow-controller.js, controller.js; src/jobpilot/search-effects.ts; tests/boss-extension-content.test.ts, tests/boss-extension-navigation.test.ts, tests/jobpilot/search-effects.test.ts; new tests/boss-experience-integration.test.ts.
**Interfaces:** v3 perform may return `{requiresPointer:true}`; only search/restore may consume this. Internal content stage `pointer` uses original validated command. `WorkflowController` supplies captured binding/scope/deadline checks and serial DOM reads to Task1 executor. No change to public contracts.
- [x] Add RED integration tests: permitted search calls pointer, forbidden tools cannot, cancel during attach, changed binding; specific safe filter errors survive service reconciliation while unknown send stays RESULT_UNKNOWN.
- [x] Integrate pointer in both initial perform and requiresFilters follow-up. Propagate explicit errors instead of swallowing known failures as navigation. Final visible filter/result checks remain mandatory.
- [x] Run task1 + affected controller/content/search/effects suites GREEN and typecheck/build.

### Task 3: Package, review and activation handoff

**Files:** manifest.json, scripts/build-boss-extension.mjs, popup.html/js status copy if needed, docs/jobpilot/search-greeting-guide.md and acceptance.md; new tests/boss-experience-package.test.ts.
- [x] Add RED package checks for debugger required permission, fixed modules included, version一致 and no optional/debugger generic command exposure.
- [x] Build version0.5.0 with required debugger; bundle experience-dom for content, copy experience-pointer for worker; preserve all prior permissions and host scope.
- [x] Run full test suite once without concurrent browser suites; typecheck/build/extension build plus unchanged Python bridge checks as appropriate.
- [x] One fresh final reviewer per executing-plans; repair important findings with failing regressions, then verify final suite. Do not dispatch review loops.
- [x] Prepare versioned reviewable build and rollback; do not silently activate expanded permission in loaded extension. Provide exact path/version/permission purpose and ask user to load/reload/accept only after checks.
- [ ] After activation, zero-contact live preview verifies at least2keywords×2bands and same-tab refresh. If live markup differs, inspect and add grounded regressions; never claim fixture success as live success. Document remaining phrase/history blockers separately and explain stage knowledge.
