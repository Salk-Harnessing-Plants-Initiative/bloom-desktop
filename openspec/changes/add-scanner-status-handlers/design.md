## Context

Two decisions in this change are non-obvious enough to warrant writing down
the reasoning, rather than leaving it only in code comments.

## Decision 1: `gridMode` sourced from `GraviConfig`, not per-scanner

Production's `graviscan:get-scanner-status` reads `scanner.grid_mode`
directly off the `GraviScanner` row it just loaded. On `main`, the
`GraviScanner` Prisma model has no `grid_mode` column — confirmed directly
against `prisma/schema.prisma`. The field exists in two other places on
`main`:

- `GraviScan.grid_mode` — a per-scan-record snapshot of the mode used for
  that specific scan (historical, immutable once written).
- `GraviConfig.grid_mode` — a global singleton config row
  (`@default("2grid")`) that governs how the _next_ scan cycle will group
  plates into rows.

**Decision**: source `gridMode` in the `get-scanner-status` response from the
`GraviConfig` singleton (one extra query, same value applied to every
scanner in the response), rather than adding a migration to give
`GraviScanner` its own `grid_mode` column to match production schema-for-
schema.

**Rationale**: `main`'s scanning model already treats grid mode as a single
global setting shared by every configured scanner for a given cycle (see
`ScanCoordinator.scanOnce()`, which reads grid mode once per cycle from the
plates payload, not per-scanner-config). Adding a per-scanner column would
imply a capability — different scanners running different grid modes
simultaneously — that doesn't exist anywhere else in `main`'s coordinator or
session-start flow. Introducing the column now would be speculative schema
surface with no consumer. If per-scanner grid mode is ever a real
requirement, it should arrive as its own proposal that also updates
`ScanCoordinator`/`startScan()`, not as a side effect of this handler port.

**Consequence**: the response's `gridMode` field is uniform across all
scanners in a single `get-scanner-status` call, by construction. A caller
that assumes per-scanner independence (matching production's contract)
would be wrong on `main` — this is called out explicitly in the handler's
docstring and in the PR description, not silently divergent.

## Decision 2: `addScanner()`'s mid-scan race guard re-enters the public method

`ScanCoordinator.addScanner()` queues a spawn behind the next
`cycle-complete` event when a scan is in flight, so a fresh subprocess spawn
doesn't disturb the active cycle's event loop. The queued handler used to
call the private `spawnSingleScanner()` directly once `cycle-complete`
fired. The restored (production-matching) version re-enters the public
`addScanner()` instead.

**Why this matters**: `scanOnce()` emits `cycle-complete` synchronously
_before_ resetting `this.state` to `'idle'` on the next line. Node's
`EventEmitter.emit()` invokes all registered listeners for that event
synchronously, in registration order, within that single call — so if two
`addScanner()` calls were queued for the _same_ `scannerId` (operator
double-clicks a "Detect" action mid-scan), both queued handlers run before
`state` flips to `'idle'`.

- **Pre-fix**: both handlers called `spawnSingleScanner()` directly. The
  first constructs a subprocess and starts its async `spawn()` (not yet
  ready). The second, running synchronously right after within the same
  `emit()` pass, finds that not-yet-ready subprocess already in the map and
  takes the "shut down the stale one, then respawn" branch — killing the
  first subprocess mid-spawn and constructing a second one. Confirmed via a
  targeted regression test (`tests/unit/scan-coordinator-add-scanner.test.ts`,
  "mid-scan race guard") against the pre-fix code: exactly 2 constructions
  and 1 premature `shutdown()` call.
- **Fixed**: both handlers re-enter `addScanner()`, which re-runs
  `hasWorker()` (still false — nothing has finished spawning) and
  `isScanning` (still `true` at this exact synchronous instant). Both
  re-queue instead of spawning: 0 constructions, 0 shutdowns, on this tick.

**Known limitation, inherited from production, not addressed here**: because
`isScanning` is still `true` at the instant of every `cycle-complete`
emission (the same ordering applies on every subsequent cycle in a
continuous/interval scan), a re-queued `addScanner()` call only actually
spawns once a `cycle-complete` fires while `state` is genuinely `'idle'`
outside of `scanOnce()`'s own synchronous emit — in practice, this means the
deferred spawn resolves on a later cycle rather than the very next one.
This is the same behavior production ships (confirmed via direct diff
comparison against the source branch's fix commit); this change restores
parity with it and does not attempt to redesign the queuing semantics
further. The regression this change targets — the double-spawn-with-
premature-shutdown within a single tick — is real and is fixed; the softer
"takes an extra cycle to settle" property is pre-existing production
behavior, out of scope here.
