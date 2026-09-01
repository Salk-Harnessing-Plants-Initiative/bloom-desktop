# Design: Fix Layout Sidebar/Nav Parity (#328, #337)

## Context

Both #328 and #337 were deferred/discovered because of `add-cylinderscan-style-ux-parity`
Tier 4's own history — see that change's archived `design.md` "Deferred
Scope" section for the original reasoning. This design doc only covers what's
new here: the decisions made while scoping this change, and the current
(post-#289/#290) shape of the files it touches.

Current `Layout.tsx` structure (re-verified directly, since #289/#290 changed
it substantially from what #328/#337 describe):

```ts
const alwaysLinks = [Home, Scientists, Phenotypers, Experiments];
const browseScansLink = { to: '/browse-scans', ... };   // cylinderscan + default mode only
const exportScansLink = { to: '/export', ... };          // cylinderscan + default mode only
const captureLinks = [Capture Scan, Camera Settings, Accessions]; // cylinderscan only
const graviscanLinks = [Configure Scanner, Capture Scan, Metadata, Browse GraviScans]; // graviscan only

const links = showCaptureLinks
  ? [...alwaysLinks, browseScansLink, exportScansLink, ...captureLinks]
  : showGraviscanLinks
    ? [...alwaysLinks, ...graviscanLinks]
    : [...alwaysLinks, browseScansLink, exportScansLink];
```

Resulting current orders (verified, not the stale orders #337 describes):

- CylinderScan: Home, Scientists, Phenotypers, Experiments, Browse Scans,
  Export Scans, Capture Scan, Camera Settings, Accessions.
- GraviScan: Home, Scientists, Phenotypers, Experiments, Configure Scanner,
  Capture Scan, Metadata, Browse GraviScans.
- Default/no-mode: Home, Scientists, Phenotypers, Experiments, Browse Scans,
  Export Scans.

`WorkflowSteps.tsx` today exports `graviScanSteps` (a flat, numbered
6-step list: Scientists, Phenotypers, Metadata, Experiments, Capture Scan,
Browse Scans → `/browse-graviscans`) and the shared `WorkflowSteps`
component that renders it. Notably, `graviScanSteps` itself has never been
updated to include "Configure Scanner" — that route was added to `Layout.tsx`
by #289/#290 but never added to the workflow-guide data, so it's already
stale independent of this change.

## Decisions

### Decision: nav-link color — lime-accented hybrid, not a literal pilot port

The pilot's actual active-nav-link styling
(`bloom-desktop-pilot/app/src/renderer/Layout.tsx:207-211`) is:

```tsx
"p-4 rounded-md text-gray-600 hover:text-gray-900 flex flex-row items-center " +
  (isActive ? "bg-stone-200" : isPending ? "pending" : "")
```

That's it — no text-color change on active, no border accent, no background
change on hover at all (only a text-color darken). `add-cylinderscan-style-ux-parity/design.md`'s
pilot-mapping table claimed "`bg-stone-200` text/border equivalents in place
of `bg-blue-50`/`text-blue-600`/`border-blue-600`" — that specific
text/border pairing was never actually attested in the pilot; it was an
extrapolation written in anticipation of a follow-up, not a verified port.

Today's bloom-desktop nav link has two UX affordances the pilot's doesn't:
colored hover feedback (`hover:bg-blue-50 hover:text-blue-600`) and a
persistent `border-r-4` active-route indicator. The user, presented with
both options directly, chose to keep both affordances and recolor them
(rather than adopt the pilot's flatter style and lose them):

- Hover: `hover:bg-stone-100 hover:text-lime-700`
- Active: `bg-stone-200 text-lime-700 border-r-4 border-lime-700`

This keeps the sidebar's existing clarity (an operator can tell which route
is active at a glance, and gets hover feedback while scanning the list) while
moving fully off blue, consistent with the rest of the lime/stone/amber
convention already established by Tier 4's `ui-color-palette` spec.

### Decision: GraviScan workflow guide — new standalone component, not a `WorkflowSteps.tsx` restructure

Mirrors `CylinderScanWorkflowGuide.tsx` (Tier 4, #175) exactly rather than
adding section/primary support to the shared `WorkflowSteps.tsx` component.
Tier 4 chose the standalone-component route specifically to avoid touching
`WorkflowSteps.tsx` while #289/#290 were in flight; that constraint is gone
now that they've merged, but the standalone pattern is still the better
choice on its own merits:

- Proven — `CylinderScanWorkflowGuide.tsx` already works, is tested, and is
  in production.
- Zero risk to any other `WorkflowSteps`/`WorkflowStep` consumer, since a
  repo-wide check (during implementation) confirms whether any exists before
  either file is touched or removed.
- Once both scan modes have dedicated guide components, `WorkflowSteps.tsx`'s
  `graviScanSteps` export, its `WorkflowStep` interface, and (if nothing else
  renders it) the `WorkflowSteps` component itself become dead code — a
  clean deletion rather than a component permanently carrying both scan
  modes' history in one increasingly special-cased render path.

### Decision: "Configure Scanner" is Daily Workflow, not Setup

GraviScan's scanners are USB flatbed scanners (Epson V600-class, per #228),
materially more fragile than CylinderScan's permanently-mounted,
Ethernet-connected Basler camera. Verified directly from open GitHub issues,
not assumed:

- **#182** — a scan failure causes a USB disconnect/reconnect with a new
  device number; the current reconnect logic uses a now-stale `bus:device`
  address, so every retry after a failure fails.
- **#230** — after physically moving scanners to different USB ports,
  Configure Scanner shows every historically-detected scanner (13 shown for
  5 physically connected in one observed case) with no in-app way to clear
  stale rows, permanently blocking a valid configuration state.
- **#245** — a banner surfacing `LIBUSB_ENDPOINT_RECOVERY` env-var state,
  because recovery behavior for these USB devices is itself
  environment-dependent.
- **#228** — a root-cause investigation into a parallel-scan race + libusb
  120s timeout + stuck-endpoint bug specific to these scanners.

`ConfigureScanner.tsx` itself is described in its own file header as
"detect/save scanners, a global resolution + grid-mode config, USB reset,
and per-scanner removal" — that's a hardware-health/troubleshooting surface,
not a one-time setup form. Given how often these scanners need
re-identification after being unplugged/replugged (the user's own framing:
"unplugging them and replugging them in is a nightmare since it isn't
obvious how to identify them via API"), Configure Scanner plays exactly the
role Camera Settings plays for CylinderScan: something to verify/confirm is
healthy before starting a session, especially before a large experiment run.
It belongs in Daily Workflow, with copy that says so explicitly (e.g.
"Verify all scanners are detected and connections are healthy before
starting a session") — not filed away in Setup alongside genuinely
infrequent tasks like registering a new Scientist.

This also gives Daily Workflow / Setup a clean structural parallel across
both modes:

| | Daily Workflow | Setup |
|---|---|---|
| CylinderScan | Camera Settings, Capture Scan (primary), Browse Scans | Scientists, Phenotypers, Accessions, Experiments |
| GraviScan | Configure Scanner, Capture Scan (primary), Browse GraviScans | Scientists, Phenotypers, Metadata, Experiments |

**Out of scope, confirmed not a gap:** the user's stated pain point also
mentioned wanting a scan preview before starting large experiments and
easier plate-metadata-attachment UX. Both already exist —
`useTestScan.ts`/`ScanControlSection.tsx` implement a one-shot "Test Scan"
verification step independent of a real session (spec: `ui-management-pages`'s
"GraviScan Test Scan"), and plate-assignment auto-fill/override is already a
substantial implemented feature (spec: "GraviScan Plate Assignment Auto-Fill
and Manual Override"). Neither is touched by this change; verified directly
rather than assumed missing.

### Decision: fix both modes' sidebar ordering, not just CylinderScan's (#337)

#337 only asks about CylinderScan's ordering and suggests checking whether
GraviScan has an analogous mismatch "worth addressing in the same pass."
GraviScan's sidebar order (Configure Scanner, Capture Scan, Metadata, Browse
GraviScans) already disagrees with `graviScanSteps`' own order (Metadata,
Experiments, Capture Scan, Browse Scans) today — a real, pre-existing
mismatch. Since this same change is what first gives GraviScan a
Daily-Workflow/Setup split to order against (piece 2 above), reordering
GraviScan's sidebar to match costs nothing extra and closes the full parity
gap in one pass rather than leaving a second, now-easily-fixable instance of
exactly the problem #337 describes.

### Decision: restructuring `alwaysLinks` to achieve the interleaved target order

Today's `alwaysLinks` (Home, Scientists, Phenotypers, Experiments) is reused
verbatim by every mode's link composition. The target orders interleave Home
alone at the top with mode-specific Daily Workflow links, then group the
Setup-category links (which differ per mode: CylinderScan adds Accessions,
GraviScan adds Metadata) afterward — a monolithic `alwaysLinks` block can't
produce this. `Layout.tsx` is restructured to:

```ts
const homeLink = { to: '/', label: 'Home', ... };
const setupLinks = [Scientists, Phenotypers, Experiments]; // shared, order preserved
```

with `Accessions` moved out of `captureLinks` into a CylinderScan-specific
setup group, and `Metadata` moved out of `graviscanLinks` into a
GraviScan-specific setup group, so each mode composes:

```ts
// cylinderscan
[homeLink, cameraSettingsLink, captureScanLink, browseScansLink, exportScansLink,
 ...setupLinks, accessionsLink]

// graviscan
[homeLink, configureScannerLink, captureScanLink, browseGraviscansLink,
 ...setupLinks, metadataLink]

// default/no-mode (unchanged order, just reassembled from the new pieces)
[homeLink, ...setupLinks, browseScansLink, exportScansLink]
```

The default/no-mode branch's rendered order is unchanged by this
restructuring (Home, Scientists, Phenotypers, Experiments, Browse Scans,
Export Scans) — #337 doesn't ask about it, and no mode-specific Daily
Workflow concept applies when there's no mode. This is verified by a
regression-guard test, not just left as an assumption.

## Risks / Trade-offs

- **Cross-mode blast radius**: `Layout.tsx`'s shell/nav-link recolor and the
  `alwaysLinks` restructuring both touch code every mode renders through.
  Mitigated by extending `tests/unit/pages/Layout.test.tsx` with explicit
  per-mode ordering assertions (not just presence/route, which is all it
  asserts today) and a manual dev-server visual check of both CylinderScan
  and GraviScan's Home/sidebar before merge — the same discipline Tier 4
  used throughout.
- **`WorkflowSteps.tsx` deletion risk**: only delete the component/interface
  once a repo-wide search confirms zero remaining consumers — if a future
  file needs a truly generic step-list renderer again, that's a fresh
  decision, not a reason to keep speculative shared code around now.
- **Judgment-call shading**: exact lime/stone shades for the nav-link hover
  and active states are a real-browser legibility call, not fully fixed by
  this doc — verified in the same manual visual check above.

## Migration Plan

None needed — UI-only change (component structure, link ordering, class
names). No data migration, no schema change, no IPC surface change.
Revertible via `git revert`.

## Open Questions

None outstanding — all decisions above (nav-link color treatment,
GraviScan-guide architecture, Configure Scanner placement, both-modes
reorder scope) were explicitly resolved with the user before this document
was written.
