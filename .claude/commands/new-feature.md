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

1. **Ensure feature branch**: Check if you are on a feature branch (not `main`). If on `main`, ask the user what branch name to create (suggest a kebab-case, verb-led name based on the feature, e.g. `add-camera-brightness`), then create and switch to it before proceeding.

2. **Understand scope**: Use subagents (Explore agent type) to explore the codebase and understand the current state relevant to this feature. Investigate existing code (`src/main/`, `src/renderer/`, `python/`), existing OpenSpec specs (`npx openspec spec list --long`) and changes (`npx openspec list`), and related capabilities before proposing anything.

3. **Ask clarifying questions**: Based on what you learned from the codebase exploration, ask the user any clarifying questions about requirements, edge cases, UX expectations, data handling, metadata needs, or scope boundaries. Do not proceed until you have clear answers.

4. **Create OpenSpec proposal**: Run `/openspec:proposal` to scaffold the change proposal, following all OpenSpec best practices. Ground the proposal in what you learned from steps 2-3. The proposal's `tasks.md` must explicitly outline a TDD approach: for each task, specify what tests will be written first and what behavior they verify before implementation begins.

5. **Review the proposal**: Invoke the `openspec-review` skill (via the Skill tool, not a slash command) to have the proposal critically reviewed by 5 specialized subagents — spec quality, code/architecture feasibility, GitHub issue alignment, TDD strategy, and scientific rigor. Fix any BLOCKING and IMPORTANT issues raised.

6. **Get user approval**: Present the reviewed proposal to the user and wait for explicit approval before proceeding to implementation.

7. **Implement with TDD**: Once approved, run `/openspec:apply` (or invoke `/tdd` directly for finer-grained control) to implement the change using test-driven development. Write tests before implementation code. Run `/lint` and `/test` after each task; mark it `- [x]` in `tasks.md` once green.

8. **Pre-merge sweep**: Before opening a PR, run `/pre-merge` (format check + lint + typecheck + test + build).

9. **Open a PR**: Use `/pr-description` for the template. Reference the OpenSpec change-id in the description.

10. **After merge**: clean up on `main` with `/cleanup-merged` — verify all `tasks.md` items are `- [x]` first.

## Related Commands

- `/openspec:proposal` — scaffold the OpenSpec proposal (step 4)
- `openspec-review` skill — critical review team (step 5)
- `/openspec:apply` — implement an approved proposal (step 7)
- `/tdd` — structured red-green-refactor loop
- `/lint`, `/test` — quality gates during implementation
- `/pre-merge` — final gate before opening PR
- `/pr-description` — generate the PR body
- `/cleanup-merged` — post-merge cleanup
