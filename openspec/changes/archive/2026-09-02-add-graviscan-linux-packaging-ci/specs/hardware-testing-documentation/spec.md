## ADDED Requirements

### Requirement: GraviScan Linux Packaged-App Deployment Is Documented

The `libusb-filter.so`/`LD_PRELOAD` packaged-app deployment mechanism, the Linux package-format choice, and any systemd/permissions caveats for running the packaged GraviScan app (distinct from the SANE scanner driver, already documented in `docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md`) SHALL be documented. This requirement covers documentation completeness only — it does not change the behavior of the already-shipped mechanism it documents, which is already specified in the `scanning` capability's "LD_PRELOAD USB Filter for Parallel Scanner Isolation" requirement.

#### Scenario: LD_PRELOAD packaged-app wiring is documented

- **WHEN** a developer looks for documentation of how the `libusb-filter.so`/`LD_PRELOAD` mechanism is applied for a packaged (not dev-mode) GraviScan install
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` describes the real code path (`forge.config.ts`'s Linux-only `extraResource`, `scanner-subprocess.ts`'s packaged-vs-dev path resolution and environment-variable wiring) and the concrete failure mode if the filter isn't applied (SANE's `epkowa` backend claims USB interfaces on every connected Epson scanner during `sane_open()`, breaking parallel multi-scanner operation)

#### Scenario: The deb/rpm/AppImage choice is documented

- **WHEN** a developer looks for documentation of why the packaged app ships as `.deb`
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` states that the real GraviScan lab machine is Ubuntu/apt-based, that `.rpm` is configured but has no current real-machine consumer, and that an AppImage maker was considered and not added, with a link to this change's design.md for the full rationale

#### Scenario: Packaged-app systemd/permissions caveats are documented

- **WHEN** a developer looks for documentation of systemd or permissions considerations for running the packaged app (not the SANE driver) on a GraviScan lab machine
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` covers this, including plainly stating that no systemd unit or autostart configuration exists in this repo today if that remains true, rather than describing a hypothetical one

#### Scenario: The new doc is discoverable from existing entry points

- **WHEN** a developer is reading `docs/PACKAGING.md` or `docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md`
- **THEN** each doc's "Related Documentation" section links to `docs/GRAVISCAN_LINUX_DEPLOYMENT.md`
