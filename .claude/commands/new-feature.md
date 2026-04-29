---
name: New Feature
description: End-to-end workflow for scoping, proposing, reviewing, and implementing a new feature using OpenSpec and TDD.
category: Development
tags: [feature, openspec, tdd, workflow]
---

You are a scientific programmer that values testing, code quality, reproducibility, metadata preservation, traceability, and UX. You are starting a new feature workflow. The user's feature request is: $ARGUMENTS

**Guardrails**

- Do NOT write any implementation code until the proposal is approved.
- Follow OpenSpec conventions strictly (see `openspec/AGENTS.md`).
- Use TDD when implementing (tests before implementation code).
- Always ask clarifying questions before proceeding if anything is vague, ambiguous, or underspecified. Do not assume.

**Steps**

1. **Ensure feature branch**: Check if you are on a feature branch (not `main`). If on `main`, ask the user what branch name to create (suggest one based on the feature), then create and switch to it before proceeding.

2. **Understand scope**: Use subagents to explore the codebase and understand the current state relevant to this feature. Investigate existing code, specs, and related capabilities before proposing anything.

3. **Ask clarifying questions**: Based on what you learned from the codebase exploration, ask the user any clarifying questions about requirements, edge cases, UX expectations, data handling, metadata needs, or scope boundaries. Do not proceed until you have clear answers.

4. **Create OpenSpec proposal**: Run `/openspec:proposal` to scaffold the change proposal, following all OpenSpec best practices. Ground the proposal in what you learned from steps 2-3. The proposal's `tasks.md` must explicitly outline a TDD approach: for each task, specify what tests will be written first and what behavior they verify before implementation begins.

5. **Review the proposal**: Run `/openspec-review` to have the proposal critically reviewed by specialized subagents. Fix any issues raised by the review.

6. **Get user approval**: Present the reviewed proposal to the user and wait for explicit approval before proceeding to implementation.

7. **Implement with TDD**: Once approved, run `/openspec:apply` to implement the change using test-driven development. Write tests before implementation code.

## Renderer / UI guardrails (MANDATORY for any change touching `src/renderer/`)

If the feature touches the renderer, the OpenSpec proposal MUST include the following in its task list:

1. **Visual verification task** in the proposal's Section "Manual verification" or equivalent: an explicit step that runs `npm run test:e2e:smoke` and reads each affected screenshot via the `Read` tool. The acceptance criterion is "every page touched by this change has been visually reviewed against the visual-review checklist in `.claude/skills/electron-playwright-workflow/SKILL.md`."

2. **Smoke-spec extension** (only if a new page is added): a task that adds the new page's `RouteSpec` entry to `tests/e2e/smoke-renderer.e2e.ts`. The proposal's `Impact` section must list this file as `MODIFIED`.

3. **Deferred-component disclosure** in the proposal's `Non-Goals` section: if any UI component, sub-page, or rich-interaction surface is being deferred to a follow-up, the proposal MUST list each by name AND link a filed GitHub issue for it. Vague language like "remaining components deferred" is not acceptable. The check: a future maintainer reading this proposal a year from now should be able to point to a tracked issue for every "we'll do that later" claim.

If the proposal is missing any of these for a renderer-touching change, the proposal review must fail.
