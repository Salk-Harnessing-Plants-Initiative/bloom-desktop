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

## Decision 2: `addScanner()` dedupes mid-scan spawns with a pending-add map

`ScanCoordinator.addScanner()` queues a spawn behind the next
`cycle-complete` event when a scan is in flight, so a fresh subprocess spawn
doesn't disturb the active cycle's event loop. Two designs for that queued
handler were tried and rejected before landing on a third.

**The constraint that breaks the obvious designs**: `scanOnce()` emits
`cycle-complete` synchronously _before_ resetting `this.state` to `'idle'`
on the next line. Node's `EventEmitter.emit()` invokes all registered
listeners for that event synchronously, in registration order, within that
single call — so every queued handler observes `isScanning === true` at the
exact instant it runs, and if two `addScanner()` calls were queued for the
_same_ `scannerId` (operator double-clicks a "Detect" action mid-scan), both
handlers run back-to-back before `state` flips to `'idle'`.

- **Attempt 1 — handler calls `spawnSingleScanner()` with no dedupe**: the
  first handler constructs a subprocess and starts its async `spawn()` (not
  yet ready). The second, running synchronously right after within the same
  `emit()` pass, finds that not-yet-ready subprocess already in the map and
  takes the "shut down the stale one, then respawn" branch — killing the
  first subprocess mid-spawn and constructing a second one. Confirmed
  against that code by a targeted regression test
  (`tests/unit/scan-coordinator-add-scanner.test.ts`): exactly 2
  constructions and 1 premature `shutdown()` call.
- **Attempt 2 — handler re-enters the public `addScanner()`** so the
  `hasWorker()` idempotency guard re-runs. This fixed the double-spawn but
  livelocked: `addScanner()`'s own `if (this.isScanning)` check is _also_
  true at that same synchronous instant, so the re-entrant call just
  registered another queued listener instead of reaching
  `spawnSingleScanner()`, and did so again on every subsequent
  `cycle-complete`, forever. Net effect: 0 subprocess constructions and a
  returned Promise that never resolved. Because `register-handlers.ts`
  serializes its spawn chain (`spawnChain`), a single wedged call also
  blocked every later queued `addScanner()` for the rest of the session.
  Confirmed empirically: the two tests above time out against this
  implementation.
- **Landed — per-scanner pending-add map**: `addScanner()` keeps
  `pendingAdds: Map<scannerId, Promise<void>>`. A mid-scan call with an
  entry already present returns that same promise (collapsing a
  double-click onto one queued spawn); otherwise it registers exactly one
  `cycle-complete` listener, which removes itself and calls
  `spawnSingleScanner()` **directly**. Calling the private helper is safe
  here precisely because dedupe already happened at queue time, and
  `spawnSingleScanner()` carries its own reuse-if-ready /
  shut-down-dead-before-respawn checks. The map entry is deleted once the
  spawn settles, so a later call for the same id is not handed a stale
  resolved promise.

**Resulting behavior**: a spawn requested mid-scan executes on the _next_
`cycle-complete` emission — during that emission, while `state` is still
nominally `'scanning'` but the cycle's actual scanning work has finished
(the emit sits after `scanOnce()`'s row-group loop). The returned Promise
resolves once that spawn settles, success or failure. Two concurrent
requests for the same scanner produce one subprocess and two resolved
promises.

**Deliberate divergence from production**: production ships the
re-entrant version from Attempt 2. That is a livelock, not a working
design, so this change does not preserve parity with it. The
`pendingAdds` map is a `main`-side fix; if the divergence matters
downstream it should be ported back to production rather than reintroduced
here.

**Remaining limitation, not addressed here**: `pendingAdds` entries (and
their `cycle-complete` listeners) are only cleared when the queued spawn
runs. `shutdown()` does not emit `cycle-complete`, so a spawn queued
immediately before app shutdown leaves its promise unresolved — harmless at
quit time, but it means `addScanner()` is not guaranteed to settle if no
further cycle ever completes. `cancelAll()` is unaffected: `scanOnce()`
still emits `cycle-complete` on its way out of a cancelled cycle.
