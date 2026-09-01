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
'p-4 rounded-md text-gray-600 hover:text-gray-900 flex flex-row items-center ' +
  (isActive ? 'bg-stone-200' : isPending ? 'pending' : '');
```

That's it — no text-color change on active, no border accent, no background
change on hover at all (only a text-color darken). Both
`add-cylinderscan-style-ux-parity/design.md`'s pilot-mapping table **and
#328's own issue text** claim "`bg-stone-200` + lime text/border" is a
literal reuse of the pilot's mapping ("The bloom-desktop-pilot repo's own
`Layout.tsx` already solves the active-nav-item case with `bg-stone-200` —
reuse that mapping (`bg-stone-200` + lime text/border) rather than inventing
a new one.") — that specific text/border pairing was never actually
attested in the pilot; it's an extrapolation that #328 itself repeats from
the Tier 4 design doc, not a verified port. This proposal knowingly deviates
from that literal issue instruction (see below for why), rather than
silently following an inherited false premise.

Today's bloom-desktop nav link has two UX affordances the pilot's doesn't:
colored hover feedback (`hover:bg-blue-50 hover:text-blue-600`) and a
persistent `border-r-4` active-route indicator. The user, presented with
both options directly, chose to keep both affordances and recolor them
(rather than adopt the pilot's flatter style and lose them):

- Hover: `hover:bg-stone-100 hover:text-lime-800`
- Active: `bg-stone-200 text-lime-800 border-r-4 border-lime-800`

This keeps the sidebar's existing clarity (an operator can tell which route
is active at a glance, and gets hover feedback while scanning the list) while
moving fully off blue, consistent with the rest of the lime/stone/amber
convention already established by Tier 4's `ui-color-palette` spec.

**Shade correction (round-1 review):** the first draft of this decision used
`text-lime-700`/`border-lime-700` for both hover and active. Computed
directly against Tailwind's default palette hex values (`lime-700` =
`#4d7c0f`, `lime-800` = `#3f6212`, `stone-100` = `#f5f5f4`, `stone-200` =
`#e7e5e4`) using the standard WCAG relative-luminance formula:
`text-lime-700` on `bg-stone-200` (the active state) computes to ≈3.98:1 —
below the 4.5:1 minimum for normal-size text (WCAG AA). Darkening to
`lime-800` fixes this: ≈5.64:1 on `bg-stone-200` (active), ≈6.49:1 on
`bg-stone-100` (hover) — both comfortably clear AA. This is a computed
correction, not a re-run of the same eyeball check that missed it the first
time; the manual visual-check task still runs, but as confirmation of a
known-good computed choice, not as the only check.

**Superseded by Revision 2 below** — the "lime-accented hybrid" framing
above turned out to be a self-consistent but ungrounded invention: neither
the pilot nor `salk-bloom` (the production web app this desktop app
uploads to) actually uses a hover-turns-lime + border-accent pattern. It
was never checked against `salk-bloom`'s real convention during the
original design pass, only against the pilot (which this decision already,
correctly, declined to copy literally) and an internal contrast
computation. The shade-correction math above (`lime-800` fixing a real
contrast failure) is still valid and reused in Revision 2, just applied to
a different, better-grounded target design.

### Revision 2: match `salk-bloom`'s actual nav/shell convention (post-implementation, live-app review)

After implementation, a manual walkthrough of the running app prompted the
user to ask that this match `salk-bloom` (`Salk-Harnessing-Plants-Initiative/bloom`,
the production web app bloom-desktop uploads scans to) more closely — not
just "lime/stone instead of blue/gray" in the abstract, but the actual
classes that app uses. Read directly, not assumed:

- `salk-bloom/web/app/app/layout.tsx` — the sidebar (`<aside>`) is
  `bg-stone-100 border-r border-stone-200`, the same surface as the main
  content area, not a separate white panel with its own shadow.
- `salk-bloom/web/components/navigation.tsx` — nav link **inactive/hover**:
  `text-stone-700 hover:bg-stone-50/70 hover:text-stone-900` (hover never
  turns lime — only the text darkens toward stone-900). Nav link
  **active**: `bg-stone-50 text-lime-700 font-medium` (a subtle lighter-stone
  pill + lime text + weight change — no border accent at all; salk-bloom
  instead pairs each link with a small leading dot, `bg-stone-400` inactive
  / `bg-lime-700` active, as its "you are here" marker).
- Primary buttons everywhere in `salk-bloom` use `bg-lime-700 hover:bg-lime-800
text-stone-50` — confirms the button-side lime-700→lime-800 hover-shade
  convention this proposal already uses elsewhere (`GraviScanWorkflowGuide`'s
  primary card, matching `CylinderScanWorkflowGuide`) is correct and doesn't
  need to change.
- `amber` in `salk-bloom` is reserved strictly for warning/caution UI, never
  primary/active state — consistent with this proposal's existing usage.

**Decisions made from this research:**

1. **Sidebar panel is unified into the shell**, not a separate white panel:
   `bg-white shadow-lg` → `bg-stone-100 border-r border-stone-200`, matching
   `salk-bloom`'s `<aside>` exactly. (User explicitly chose this "full match"
   over a narrower "just fix the nav-link colors, keep the white panel"
   option when asked.)
2. **Active nav-link state drops the border accent entirely**, matching
   `salk-bloom`: `bg-stone-50 text-lime-700 font-medium` — no
   `border-r-4`/`border-lime-*`. No dot indicator is added, unlike
   `salk-bloom`'s literal markup: bloom-desktop's nav links already carry a
   per-link SVG icon (which `salk-bloom`'s nav doesn't have), and the icon
   already serves the "at-a-glance identify this row" role a dot exists to
   provide in an icon-less nav — adding a redundant dot alongside an
   existing icon would be clutter, not a faithful port. The combination of
   background, text color, and font weight (`bg-stone-50`, `text-lime-700`,
   `font-medium`) is the actual signal salk-bloom relies on to mark
   "active" (the dot is secondary, reinforcing the same three properties),
   so dropping only the dot preserves the real mechanism.
3. **Hover state drops lime entirely**, matching `salk-bloom`:
   `hover:bg-stone-50/70 hover:text-stone-900` — hover no longer previews
   the active color; it's a plain stone darken, exactly like the reference
   app. (Round-2 `/review-pr` correction: this was first shipped as
   `hover:bg-stone-50` at full opacity — cosmetically almost identical, but
   not a literal port; `salk-bloom/web/components/navigation.tsx:47` uses
   `/70` opacity specifically. Fixed to match exactly, since the whole
   point of this revision was reading the real source rather than
   approximating it.)
4. **Active text reverts to `lime-700`, not `lime-800`.** This is safe
   contrast-wise specifically because the background also changed — active
   state is now `bg-stone-50` (`#fafaf9`), lighter than the abandoned
   `bg-stone-200` (`#e7e5e4`) the Revision 1 contrast failure was computed
   against. Recomputed directly: `lime-700` (`#4d7c0f`) on `bg-stone-50`
   (`#fafaf9`) is ≈4.79:1 — clears WCAG AA's 4.5:1 minimum for normal-size
   text (a slim margin, but a real pass, and better than Revision 1's
   original `lime-700`-on-`stone-200` failure at ≈3.98:1). `lime-700` was
   not re-adopted carelessly; it was re-verified against the new background
   before use, and matches `salk-bloom`'s literal active-text color, not an
   independent shade choice.
5. **Base (non-active, non-hover) nav-link text becomes `text-stone-700`**,
   not `text-gray-700` — matching `salk-bloom` and completing the move off
   the `gray-*` scale for this component, consistent with the rest of this
   proposal's stone/lime convention.

**Deliberately not changed:** the "Bloom Desktop" title, mode label, and
scanner-name footer text colors in `Layout.tsx` (still `text-gray-800`/
`text-gray-500`) — out of scope for both #328's original ask and this
correction; touching every gray text label in the file is a larger sweep
than "match the shell/sidebar/nav-link convention" calls for.

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
not assumed — and re-weighted after round-1 review, which correctly flagged
that not all four originally-cited issues carry equal weight:

- **#230 (primary, direct evidence)** — after physically moving scanners to
  different USB ports, Configure Scanner shows every historically-detected
  scanner (13 shown for 5 physically connected in one observed case) with no
  in-app way to clear stale rows, permanently blocking a valid configuration
  state. This is squarely about the Configure Scanner _screen_ failing
  operators after a real, common physical event — the strongest direct
  support for putting it somewhere operators will actually revisit.
- **#182, #228 (general fragility context, not direct evidence for
  placement)** — #182 is about backend reconnect logic (USB device
  renumbering after a scan failure), and #228 is a root-cause investigation
  into a mid-scan parallel-scan race/stuck-endpoint bug whose own recommended
  fix is a session-time failure-mode UX change, not a Configure Scanner
  placement question. Both support "these scanners are fragile in general,"
  which is real and relevant background, but neither is direct evidence that
  Configure Scanner itself needs pre-session attention. Cited here as
  context, not as proof.
- **#245 — dropped as a citation.** Round-1 review found this issue is
  about an unrelated feature (a header status pill for Slack-webhook/
  `LIBUSB_ENDPOINT_RECOVERY` env-var health, filed against `main.ts`) that
  never mentions Configure Scanner at all. Citing it as supporting evidence
  for this placement decision was an overreach in the original draft;
  removed rather than kept as padding.

`ConfigureScanner.tsx` itself is described in its own file header as
"detect/save scanners, a global resolution + grid-mode config, USB reset,
and per-scanner removal" — that's a hardware-health/troubleshooting surface,
not a one-time setup form. #230 alone is enough to place it in Daily
Workflow rather than Setup, alongside genuinely infrequent tasks like
registering a new Scientist.

**Copy framing (round-1 review correction):** the original draft's copy —
"Verify all scanners are detected and connections are healthy before
starting a session" — was flagged as risking alert fatigue: none of #182/
#230/#228 describe a problem detectable on a normal day when nothing was
physically touched, so a blanket "every session" framing risks operators
tuning it out on the (most) days nothing is actually wrong, exactly the
days it wouldn't matter, while under-signaling urgency on the days that do
(right after a cable move or a scan failure). The copy is corrected to
condition-specific framing: "Check scanner detection and connection
health — especially after moving cables or a prior scan failure." This
still lives in Daily Workflow (it's still worth a quick glance each
session) but no longer implies mandatory reconfiguration every time.

**Verify vs. configure conflation (round-1 review finding):** `ConfigureScanner.tsx`
also hosts a "Reset USB" action (`handleResetUsb`) and a per-scanner
"Remove" action (`handleRemove`), confirmed to have **no confirmation
dialog guard** on either (`grep`-checked directly — no `window.confirm`/
"Are you sure" anywhere in the file). Prominent Daily Workflow placement
with "just check things are healthy" copy risks inviting more casual clicks
into a page containing unguarded destructive controls than that page's risk
profile warrants. Adding a confirmation guard to those actions is a real
`ConfigureScanner.tsx` behavior change, out of scope for this Layout.tsx/
workflow-guide-only change — flagged as a follow-up issue to file (see
`tasks.md` §7) rather than silently left unaddressed.

This also gives Daily Workflow / Setup a clean structural parallel across
both modes:

|              | Daily Workflow                                               | Setup                                            |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| CylinderScan | Camera Settings, Capture Scan (primary), Browse Scans        | Scientists, Phenotypers, Accessions, Experiments |
| GraviScan    | Configure Scanner, Capture Scan (primary), Browse GraviScans | Scientists, Phenotypers, Metadata, Experiments   |

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
Setup-category links (which differ per mode: CylinderScan adds Accessions
_before_ Experiments, GraviScan adds Metadata _before_ Experiments)
afterward — a monolithic `alwaysLinks` block can't produce this.

**Composition bug found and fixed (round-1 review):** the first draft of
this decision defined `setupLinks = [Scientists, Phenotypers, Experiments]`
and composed each mode as `[...setupLinks, accessionsLink]` /
`[...setupLinks, metadataLink]`. Two independent reviewers (code-feasibility
and TDD-strategy) confirmed this is mechanically wrong: spreading an array
that already ends in `Experiments` and appending one more link after it can
only ever place that link _last_ — producing `...Experiments, Accessions`
and `...Experiments, Metadata`, the exact reverse of the target order
(`...Accessions, Experiments` / `...Metadata, Experiments`) stated in this
proposal's own spec delta and `tasks.md`'s own test description. The fix:
keep `Experiments` out of the shared array entirely, and append it last in
each mode's own composition, after the mode-specific Setup link:

```ts
const homeLink = { to: '/', label: 'Home', ... };
const setupLinks = [Scientists, Phenotypers]; // shared, order preserved — Experiments is NOT in this array
```

with `Accessions` moved out of `captureLinks` into a CylinderScan-specific
setup group, and `Metadata` moved out of `graviscanLinks` into a
GraviScan-specific setup group, so each mode composes:

```ts
// cylinderscan
[homeLink, cameraSettingsLink, captureScanLink, browseScansLink, exportScansLink,
 ...setupLinks, accessionsLink, experimentsLink]
// = Home, Camera Settings, Capture Scan, Browse Scans, Export Scans,
//   Scientists, Phenotypers, Accessions, Experiments  ✓ matches spec delta

// graviscan
[homeLink, configureScannerLink, captureScanLink, browseGraviscansLink,
 ...setupLinks, metadataLink, experimentsLink]
// = Home, Configure Scanner, Capture Scan, Browse GraviScans,
//   Scientists, Phenotypers, Metadata, Experiments  ✓ matches spec delta

// default/no-mode (unchanged order, just reassembled from the new pieces)
[homeLink, ...setupLinks, experimentsLink, browseScansLink, exportScansLink]
// = Home, Scientists, Phenotypers, Experiments, Browse Scans, Export Scans  ✓ unchanged
```

The default/no-mode branch's rendered order is unchanged by this
restructuring — #337 doesn't ask about it, and no mode-specific Daily
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
  decision, not a reason to keep speculative shared code around now. Round-1
  code-feasibility and TDD review both independently found real consumers a
  narrow identifier-only grep would miss: the numeric `workflow-step-N`
  testid string itself (not the `WorkflowSteps`/`graviScanSteps` identifiers)
  is hard-coded in `tests/unit/pages/App.test.tsx` (a now-vacuous regression
  guard) and `tests/e2e/graviscan-browse-metadata.e2e.ts` (a selector that
  breaks outright) — both fixed in `tasks.md` §4.3, not left for the §4.4
  grep alone to catch.
- **Judgment-call shading**: resolved by computation, not left to
  eyeballing alone — see the "nav-link color" decision's shade correction
  above (`lime-800`, not `lime-700`, computed to clear WCAG AA in Revision
  1's design). Revision 2 subsequently replaced that design with
  `salk-bloom`'s real convention (`lime-700` on a lighter `bg-stone-50`,
  independently recomputed to still clear AA) — the manual visual check
  that finally ran (a real screenshot from the user, once port 9000 freed
  up) is exactly what surfaced that Revision 1's invented pattern, while
  internally contrast-correct, didn't match the app it was supposed to
  align with. This is the risk this checklist item was meant to catch,
  working as intended, just later than planned.
- **Copy drifted from the app's real scope**: `GraviScanWorkflowGuide.tsx`'s
  Capture Scan/Experiments descriptions were carried over verbatim from the
  retired `graviScanSteps` data, which described both in gravitropism-only
  terms. The user caught this during the same walkthrough — GraviScan
  scanners run other kinds of studies too. Corrected to
  mode-appropriate, non-overclaiming copy ("Capture a time-lapse scan",
  "Create experiments to run on the scanner").
- **Operator muscle-memory disruption**: the sidebar reorder (#337) changes
  spatial positions operators click by habit, under real lab time pressure,
  dozens of times a day. Round-1 review flagged that neither this design doc
  nor `tasks.md` originally accounted for any transition cost. Mitigated by
  a one-time team heads-up (see `tasks.md` §7) before/at merge — cheap,
  and reduces confusion risk for a change explicitly about
  muscle-memory-sensitive UI.

## Migration Plan

None needed — UI-only change (component structure, link ordering, class
names). No data migration, no schema change, no IPC surface change.
Revertible via `git revert`.

## Open Questions

None outstanding. All Revision 1 decisions (nav-link color treatment,
GraviScan-guide architecture, Configure Scanner placement, both-modes
reorder scope) were explicitly resolved with the user before implementation
started. Revision 2's one open question — whether matching `salk-bloom`
should extend to unifying the sidebar's own background/panel, or stop at
just the nav-link colors — was also explicitly resolved with the user (full
unification chosen) before implementing.
