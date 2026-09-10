## Context

Issue #279's checklist has one item worded specifically for the production rig: "Run a multi-hour continuous interval session on the production rig and confirm no false-positive auto-pauses occur under normal operation." Every other item in this Tier 1 increment uses `pbiob-gh-04` (dev/test rig) — per the roadmap's own guidance and this repo's standing rule that `graviscan-ms-7c56` (production rig) is never touched for non-production work, since it may be mid-experiment.

This is a genuine conflict, not an oversight: the issue's own text asks for the production rig specifically, for a reason — a dev-rig session cannot reproduce production's actual scanner count, USB topology, or duty cycle, all of which matter for a "no false positives under normal operation" claim.

## Goals / Non-Goals

- Goals:
  - Every bench-testable item in #279's checklist gets executed and recorded against real hardware on `pbiob-gh-04`.
  - The production-rig-specific item is explicitly resolved, not silently dropped or silently satisfied by a substitute.
- Non-Goals:
  - Running any part of this validation on `graviscan-ms-7c56` in this increment.
  - Building any new fault-injection tooling for CI (out of scope — this is manual, human-in-the-loop validation).

## Decisions

### Decision: Defer the production-rig multi-hour item to a Tier 2 pre-cutover gate — filed and wired into the roadmap, not just described

Rather than substitute an equivalent dev-rig session now, the multi-hour continuous-interval, no-false-positive validation is deferred out of this increment entirely and tracked as its own explicit gate before production cutover (Tier 2 of the roadmap). Rationale:

- A dev-rig substitute would produce weaker evidence than the issue actually asks for (different scanner count/USB topology/duty cycle than production), and presenting that as satisfying the issue's own wording would overstate what was actually validated.
- Deferring is honest about what this increment did and didn't cover, and creates a concrete, trackable gate rather than an implicit assumption that "some validation happened so we're fine."
- This mirrors the pattern already used elsewhere in this project (e.g. #281's own items being tracked individually rather than bundled into a single all-or-nothing resolution).

This decision was made in consultation with the person driving this increment, given the conflict is explicit in the issue text and not something to resolve unilaterally.

**Concretely wired, not just asserted**: an earlier draft of this design said the deferral would be "mitigated by filing it as a concrete, linked tracking item" — but left that as a to-do rather than actually doing it, and the roadmap doc's own Tier 2 hard-block mechanism (`docs/superpowers/plans/2026-09-02-graviscan-production-cutover-roadmap.md`, line 59/66/85) checks `#279`'s open/closed state directly. Since this change's own task 3.3 closes #279 once its dev-rig-validatable items pass, closing #279 alone would silently clear that mechanical gate even though the production-rig item remains outstanding — exactly the failure mode this decision claims to avoid. **Fixed**: issue #364 was filed as the concrete tracking issue (not a future task), and the roadmap doc's Tier 2 hard-block list was updated to name #364 directly alongside #279/#226/#361, so the gate no longer silently clears when #279 closes.

## Risks / Trade-offs

- The wedge-response feature goes into broader use (dev-rig-validated only) before the production-rig-specific multi-hour check runs. Accepted: the bench-test items (the ones that actually exercise the wedge/retry logic paths) are fully covered on `pbiob-gh-04`; the deferred item is specifically about false-positive *rate* under production's own conditions, a narrower and lower-severity concern than the bench-test items (which cover whether the safety mechanism works at all).
- The Tier 2 gate must actually get scheduled and not slip indefinitely — mitigated by #364 existing as a real, filed issue directly named in the roadmap's Tier 2 hard-block list (see above), not merely a described intention.
