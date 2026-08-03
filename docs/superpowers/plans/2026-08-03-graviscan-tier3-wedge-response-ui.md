# Tier 3 — Wedge-Response UI: Pre-Proposal Notes

**Roadmap:** `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`, Tier 3.
**Depends on:** Tier 2 (merged, PR #274, commit `9805bba`). Does **not** need Tier 1's
Configure Scanner screen or the full Tier 4 scan screen.
**Related issues:** #244 ("permanent data loss, no recovery" for wedged time-lapse
experiments), #240 (no in-UI wedge banner today).

## Why this tier is fast-tracked

Pulled out of the original Tier 4 bundle specifically because #244 describes real,
irreversible data loss risk on a safety-relevant path, and bundling it into the
larger, higher-rebuild-risk core scan screen would couple a safety fix's timeline
to the tier most likely to slip.

## Scope (from the roadmap)

An in-UI wedge banner (#240) with resume/skip/retry affordances (#244), rendered
against a minimal placeholder scan-state view — merged into the full Tier 4 screen
once that lands, not held until then.

## Prerequisite decision — resolved 2026-08-03

Tier 2's granular event model made coordinator-originated scan errors (row-timeout,
missing/zero-byte output file — see `scan-coordinator.ts`'s `scanOnce()`, 4 direct
`emit('scan-error', ...)` call sites) visible to wedge detection for the first time.
This was flagged in Tier 2's design doc (Open Question 2) as needing explicit
sign-off before Tier 3 relies on it, with a recommended backtest first.

**Backtest done, sign-off given.** Pulled the real production rig's logs
(`graviscan@graviscan-ms-7c56.tail461d0e.ts.net:~/.bloom/logs/`, 2026-05-26 through
2026-08-01, ~10 weeks):

- Zero wedge alerts have ever fired on this rig in that window.
- Zero zero-byte output files among all 28,980 `.tif` files still on disk.
- Zero individual scan-error log entries of any kind.

Caveat for whoever reads this later: the rig runs the *production* branch, which
doesn't have main's coordinator-level row-timeout/file-verification checks at all
— so this backtests the underlying physical failure conditions as the best
available proxy, not an exact replay of the new code path. Small sample (one rig,
~10 weeks); zero-byte files produced and later cleaned up wouldn't show up in a
live-disk scan. With that caveat: no evidence of any relevant failure, ever, on
this rig. **Proceed with Tier 3 without further gating on this question** — don't
re-litigate it unless new evidence surfaces.

## Next step

Run `/new-feature` (this repo's brainstorm → OpenSpec proposal → `openspec-review`
5-agent adversarial pass → user approval → `/openspec:apply` TDD → `/pre-merge` →
PR → `/cleanup-merged` workflow). This worktree is already on its own branch
(`add-graviscan-wedge-response-ui`, based on `main` @ `2d90a0c`) — a sibling
`add-wave-scoped-metadata-linking` proposal is running in parallel in a different
worktree (`../bloom-desktop-wave-metadata-linking`); they touch unrelated files
(this tier is UI + wedge-detector consumption only, no DB schema), so no
coordination note is expected, but confirm that's still true once this proposal's
Impact section is drafted.
