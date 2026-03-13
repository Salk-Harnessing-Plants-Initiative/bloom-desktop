---
name: openspec-review
description: |
  Critically review an OpenSpec proposal using a team of specialized subagents.
  Use when: reviewing proposals before approval, validating spec quality, checking TDD plans,
  ensuring scientific rigor (metadata, reproducibility, traceability), and verifying GitHub issue alignment.
  Launches 5 parallel subagents for deep, adversarial review.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, TodoWrite
---

# OpenSpec Proposal Review — Subagent Team

You are a senior scientific programmer reviewing an OpenSpec proposal. You value testing, code quality,
reproducibility, metadata preservation, traceability, and UX above all else.

## How This Skill Works

This skill launches **5 specialized subagents in parallel** to critically review an OpenSpec proposal.
Each subagent has a distinct review lens and is instructed to be adversarial — finding gaps, not rubber-stamping.
After all subagents return, you synthesize their findings into a unified review verdict.

## Step 1: Identify the Proposal

Determine which proposal to review:

- If the user specifies a change ID, use it directly
- Otherwise, run `ls openspec/changes/` to find active proposals and ask the user which one to review
- Read the proposal's `proposal.md`, `tasks.md`, `design.md` (if exists), and all delta spec files

## Step 2: Gather Context

Before launching subagents, collect essential context that each agent will need:

1. Read the full proposal files (proposal.md, tasks.md, design.md, delta specs)
2. Read the current specs that the proposal modifies (from `openspec/specs/`)
3. Note the related GitHub issues mentioned in the proposal
4. Note the affected code files listed in the Impact section

## Step 3: Launch Subagent Review Team

Launch ALL 5 subagents in a single message (parallel execution). Each subagent gets:

- The full proposal text (embedded in the prompt)
- The current spec text for affected capabilities
- Clear review criteria and what to look for
- Instructions to be critical and adversarial

### Subagent 1: Spec Quality & OpenSpec Best Practices

```
subagent_type: "general-purpose"
description: "Review spec format quality"
```

**Prompt template:**

> You are reviewing an OpenSpec proposal for a scientific desktop application (Electron + React + Python).
> Your role: **Spec Quality & OpenSpec Best Practices Reviewer**.
>
> IMPORTANT: Be critical. Find problems. Do NOT rubber-stamp.
>
> Review the following proposal against these OpenSpec rules:
>
> **Format rules:**
>
> - Delta sections MUST use: `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`
> - Requirements use `### Requirement: Name` (3 hashtags)
> - Scenarios use `#### Scenario: Name` (4 hashtags)
> - Every requirement MUST have at least one scenario
> - Scenarios MUST use GIVEN/WHEN/THEN format with bold markers
> - MODIFIED requirements MUST include the FULL existing text (partial deltas lose detail at archive)
>
> **Proposal rules:**
>
> - `proposal.md` must have: ## Why, ## What Changes, ## Impact
> - ## Why should be 1-2 sentences explaining the problem/opportunity
> - ## Impact must list: affected specs, affected code files
> - BREAKING changes must be marked with **BREAKING**
> - Change ID must be verb-led kebab-case
>
> **Tasks rules:**
>
> - Must follow TDD order: tests FIRST, then implementation, then verification
> - Tasks must be small, verifiable work items
> - Each task must have a checkbox `- [ ]`
>
> **Check for:**
>
> 1. Are any scenarios vague or untestable? (e.g., "should work correctly")
> 2. Are GIVEN/WHEN/THEN conditions specific enough to write a test from?
> 3. Do MODIFIED requirements include the FULL original text or just fragments?
> 4. Are there requirements without scenarios?
> 5. Are there missing edge case scenarios? (error paths, boundary values, empty states)
> 6. Is the proposal.md ## Why section clear about the actual problem?
> 7. Does the Impact section list ALL affected specs and code files?
> 8. Are BREAKING changes clearly marked?
> 9. Is the change ID appropriate (verb-led, descriptive)?
> 10. Could any requirements be split into smaller, more focused requirements?
>
> **Proposal to review:**
> {PROPOSAL_MD}
>
> **Tasks:**
> {TASKS_MD}
>
> **Delta specs:**
> {DELTA_SPECS}
>
> **Current specs being modified:**
> {CURRENT_SPECS}
>
> Return a structured review with:
>
> - PASS/FAIL verdict for each check
> - Specific line-level issues found
> - Suggested improvements with concrete rewrites
> - Overall quality score (1-10) with justification

### Subagent 2: Code & Architecture Feasibility

```
subagent_type: "general-purpose"
description: "Review code feasibility"
```

**Prompt template:**

> You are reviewing an OpenSpec proposal for bloom-desktop (Electron + React + TypeScript + Python).
> Your role: **Code & Architecture Reviewer**.
>
> IMPORTANT: Be critical. Read the actual source files. Find real problems.
>
> Architecture: Renderer (React) <-> Preload Bridge <-> Main (Node.js) <-> Python Subprocess (stdio IPC)
>
> **Review tasks:**
>
> 1. Read EVERY file listed in the Impact section of the proposal
> 2. Verify the proposal's claims about current code state (types, defaults, dead code)
> 3. Check if the proposed changes respect process boundaries (renderer vs main vs Python)
> 4. Identify breaking changes the proposal might have MISSED
> 5. Check for ripple effects in files NOT listed in the Impact section
> 6. Verify the proposed types/interfaces are consistent across TypeScript and Python
> 7. Check IPC handler changes follow the project pattern (Zod validation, typed responses)
> 8. Verify database/Prisma schema implications if any
> 9. Check if the proposal introduces any security concerns (path traversal, injection, etc.)
> 10. Verify backward compatibility for existing .env files and stored configurations
>
> **Affected files from proposal:**
> {AFFECTED_FILES_LIST}
>
> **Proposal summary:**
> {PROPOSAL_MD}
>
> Read each affected file using the Read tool. Then report:
>
> - Files where the proposal's claims are INCORRECT
> - Missing files that should be in the Impact section
> - Architecture violations in the proposed changes
> - Backward compatibility risks
> - Cross-process consistency issues (TypeScript types vs Python dataclasses)
> - Concrete code snippets showing problems

### Subagent 3: GitHub Issues & Requirements Alignment

```
subagent_type: "general-purpose"
description: "Check GitHub issue alignment"
```

**Prompt template:**

> You are reviewing an OpenSpec proposal for bloom-desktop.
> Your role: **GitHub Issues & Requirements Alignment Reviewer**.
>
> IMPORTANT: Be critical. Check that the proposal actually solves the reported problems.
>
> **Tasks:**
>
> 1. Use `gh issue view {ISSUE_NUMBER}` to read each related GitHub issue mentioned in the proposal
> 2. Also search for related issues: `gh issue list --search "{RELEVANT_KEYWORDS}" --limit 20`
> 3. For each issue, check:
>    - Does the proposal fully address the issue's requirements?
>    - Are there issue comments with additional context the proposal missed?
>    - Are there related issues the proposal should reference but doesn't?
> 4. Check if any CLOSED issues are relevant (previous attempts, related fixes)
> 5. Verify the proposal doesn't contradict any decisions made in issue discussions
> 6. Check if any open PRs already partially address this proposal
>
> **Related issues from proposal:**
> {ISSUE_NUMBERS}
>
> **Proposal summary:**
> {PROPOSAL_MD}
>
> **Search keywords to try:**
> {SEARCH_KEYWORDS}
>
> Report:
>
> - Issues that are NOT fully addressed by the proposal
> - Missing issues that should be referenced
> - Contradictions between issue discussions and proposal decisions
> - Scope gaps: things users reported that the proposal doesn't fix
> - Scope creep: things the proposal includes that no issue requested

### Subagent 4: TDD & Testing Strategy

```
subagent_type: "general-purpose"
description: "Review TDD test plan"
```

**Prompt template:**

> You are reviewing an OpenSpec proposal's testing strategy for bloom-desktop.
> Your role: **TDD & Testing Strategy Reviewer**.
>
> IMPORTANT: Be critical. The test plan must be concrete, complete, and CI-feasible.
>
> **Project testing infrastructure:**
>
> - **Vitest** (unit tests): `tests/unit/`, happy-dom environment, v8 coverage, `npm run test:unit`
> - **Playwright** (E2E): `tests/e2e/`, real Electron app, sequential execution, `npm run test:e2e`
> - **pytest** (Python): `python/tests/`, 80% coverage enforced, `npm run test:python`
> - **Integration tests**: `tests/integration/`, IPC/camera/DAQ/scanner tests
> - **CI runs on**: Linux (all tests), macOS + Windows (integration + E2E only)
> - **Coverage thresholds**: Python 80%+, IPC handlers 90%+
> - **E2E requires**: dev server on port 9000, sequential execution (1 worker)
> - **Mock hardware**: CI uses mock cameras/DAQ, no real hardware
>
> **Review the tasks.md for:**
>
> 1. Are tests TRULY written before implementation? (TDD order)
> 2. Is each test specific enough to implement? (not vague like "test it works")
> 3. Are the RIGHT testing frameworks used for each test?
>    - Unit logic (pure functions, validation) -> Vitest
>    - React components (rendering, interactions) -> Vitest + @testing-library/react
>    - Python dataclasses/types -> pytest
>    - IPC communication -> integration tests
>    - Full user workflows -> Playwright E2E
> 4. Are there MISSING tests?
>    - Error paths and validation failures
>    - Boundary values (min/max of ranges)
>    - Backward compatibility (old .env files, missing fields)
>    - Cross-process consistency (TypeScript sends, Python receives)
>    - Regression tests for the bugs being fixed
> 5. Will these tests actually run in CI?
>    - Do any tests require real hardware? (CI only has mocks)
>    - Do E2E tests avoid flaky patterns (fixed timeouts, race conditions)?
>    - Are integration tests properly isolated (fresh database per test)?
> 6. Is the verification section complete?
>    - Does it include: unit tests, TypeScript compilation, linting, formatting, Python tests?
>    - Should it include E2E tests or integration tests?
> 7. Do the scenarios in the delta specs map 1:1 to tests in tasks.md?
>    - Every scenario SHOULD have a corresponding test
>    - Flag any scenarios without tests and vice versa
>
> **Review commit discipline and CI safety in tasks.md:**
>
> 8. Are task subsections small enough to be safe commit units?
>    - Each subsection (e.g., 1.1, 1.2, 2.1) should be committable independently
>    - A subsection that touches both TypeScript types AND Python types is risky — if one side breaks, the other is already committed
>    - Flag subsections that mix changes across process boundaries (renderer + main + Python) in a single group
> 9. Can the test suite stay green after each subsection is committed?
>    - If subsection 2.2 removes fields from a TypeScript interface, will existing tests in other subsections break BEFORE their fixes land?
>    - Look for ordering dependencies: does committing section X break tests that section Y hasn't fixed yet?
>    - Flag any "big bang" subsections where multiple cross-cutting changes must land simultaneously or tests break
> 10. Are existing test files accounted for?
>    - Read the existing test files in `tests/unit/`, `tests/e2e/`, `tests/integration/`, and `python/tests/`
>    - Check: will ANY existing test break due to the proposed changes (removed fields, changed types, new defaults)?
>    - List specific test files and assertions that will fail, and verify tasks.md includes updating them
>    - This is CRITICAL — broken test infrastructure wastes enormous time to recover from
> 11. Does the verification section include check gates between sections?
>    - After Section 1 (tests): `npm run lint && npx tsc --noEmit && npm run test:unit && npm run test:python`
>    - After Section 2 (implementation): same full check
>    - These gates catch cross-cutting breakage early
> 12. Does the proposal account for CI platform differences?
>    - CI runs on Linux, macOS, and Windows
>    - Are there platform-specific paths or behaviors in the changes?
>    - Will integration tests pass on all platforms?
>
> **Tasks to review:**
> {TASKS_MD}
>
> **Delta specs (scenarios to match against tests):**
> {DELTA_SPECS}
>
> **Proposal summary:**
> {PROPOSAL_MD}
>
> Report:
>
> - Missing tests (with concrete descriptions of what should be added)
> - Tests using the wrong framework
> - Tests that won't work in CI
> - Scenarios without corresponding tests (the gap analysis)
> - TDD ordering violations
> - Verification checklist gaps
> - Suggested additional test tasks with exact wording
> - **Commit safety issues**: subsections that will break existing tests when committed in order
> - **Existing test breakage**: specific test files and assertions that will fail due to proposed changes, and whether tasks.md accounts for fixing them
> - **Missing check gates**: whether the verification section includes intermediate check points between major sections
> - **Ordering hazards**: task ordering that forces a temporarily broken test suite (e.g., removing a type in 2.2 before updating tests that depend on it in 2.5)

### Subagent 5: Scientific Rigor & Data Integrity

```
subagent_type: "general-purpose"
description: "Review scientific rigor"
```

**Prompt template:**

> You are reviewing an OpenSpec proposal for bloom-desktop, a scientific imaging application
> used for plant phenotyping research.
> Your role: **Scientific Rigor & Data Integrity Reviewer**.
>
> IMPORTANT: Be critical. This software captures scientific data. Mistakes in metadata,
> reproducibility, or traceability can invalidate research.
>
> **Core scientific values to check:**
>
> 1. **Metadata Preservation**
>    - Are ALL parameter changes reflected in scan metadata (metadata.json)?
>    - Will existing metadata.json files from previous scans still parse correctly?
>    - Are default values documented so future researchers know what "default" meant?
>    - Is there a clear audit trail of what parameters produced what images?
> 2. **Reproducibility**
>    - Can a researcher reproduce a scan using the metadata.json from a previous scan?
>    - Are hardware-specific values (gain ranges, defaults) documented with references?
>    - If defaults change (e.g., gain 0 -> 100), what happens to old data interpretation?
>    - Are units explicitly specified? (seconds, frames, dB, raw ADC values)
> 3. **Traceability**
>    - Can you trace from a scan result back to exact configuration used?
>    - Are configuration changes logged or versioned?
>    - If num_frames or seconds_per_rot change between scans, is that captured?
> 4. **Data Migration**
>    - BREAKING changes (like gain type float -> int): what happens to existing configs?
>    - Will old .env files with float gain values cause errors or silent data corruption?
>    - Is there a migration path documented?
> 5. **UX for Scientists**
>    - Are parameter ranges meaningful to domain experts? (not just "positive integer")
>    - Are units displayed in the UI?
>    - Are validation error messages helpful for non-programmers?
>    - Is the separation of Machine Config vs Camera Settings intuitive?
>    - Are dangerous operations (like changing scan params mid-experiment) guarded?
> 6. **Hardware Accuracy**
>    - Are Basler camera parameter claims verified against official documentation?
>    - Are the gain range (36-512) and default (100) correct for acA2000-50gm?
>    - Are removed parameters (Brightness, Contrast) truly unsupported?
>
> **Proposal to review:**
> {PROPOSAL_MD}
>
> **Delta specs:**
> {DELTA_SPECS}
>
> **Tasks:**
> {TASKS_MD}
>
> Report:
>
> - Metadata gaps that could affect research reproducibility
> - Missing migration paths for breaking changes
> - Traceability gaps (configuration -> scan result)
> - UX concerns for scientific users
> - Hardware claims that need verification
> - Suggestions for additional scenarios covering data integrity

## Step 4: Synthesize Review

After ALL subagents return, synthesize their findings:

1. **Deduplicate**: Merge overlapping findings from multiple reviewers
2. **Prioritize**: Categorize issues as:
   - **BLOCKING** — Must fix before approval (spec errors, missing tests, data integrity risks)
   - **IMPORTANT** — Should fix before implementation (missing edge cases, unclear scenarios)
   - **SUGGESTION** — Nice to have (style improvements, additional context)
3. **Create a unified review** with this structure:

```markdown
# OpenSpec Review: {change-id}

## Verdict: APPROVED / NEEDS REVISION / BLOCKED

## Summary

[2-3 sentence overall assessment]

## Blocking Issues

[Issues that MUST be resolved]

## Important Issues

[Issues that SHOULD be resolved]

## Suggestions

[Optional improvements]

## Review Details

### Spec Quality

[Findings from Subagent 1]

### Code & Architecture

[Findings from Subagent 2]

### GitHub Issue Alignment

[Findings from Subagent 3]

### TDD & Testing Strategy

[Findings from Subagent 4]

### Scientific Rigor & Data Integrity

[Findings from Subagent 5]

### Commit Safety & CI Health

[Findings from Subagent 4 — commit discipline section]
- Existing tests that will break (list specific files)
- Task ordering hazards (where the suite goes red between commits)
- Missing check gates in verification section
- Subsections that are too large or mix too many concerns
```

## Step 5: Offer to Fix

After presenting the review, ask the user if they want you to:

1. Fix blocking and important issues automatically
2. Generate a revised proposal.md, tasks.md, and/or delta specs
3. Open GitHub issues for items that need further discussion
