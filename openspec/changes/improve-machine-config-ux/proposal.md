# Proposal: Improve Machine Configuration UX

**Status:** Draft
**Author:** AI Assistant
**Created:** 2026-01-26
**Change ID:** improve-machine-config-ux

## Problem Statement

The current Machine Configuration page has a suboptimal user experience where Bloom API credentials are positioned at the bottom of the form, after the "Machine Identity" and "Hardware" sections. This creates confusion because:

1. **Scanner name dropdown depends on credentials** - Users must scroll down to enter credentials before they can select a scanner at the top
2. **Logical flow is reversed** - The page requires credentials first (for API access) but presents them last
3. **First-run experience is confusing** - New users see disabled fields (scanner dropdown) before understanding they need to configure credentials
4. **Unnecessary scrolling** - Users must scroll down to enter credentials, then scroll back up to complete the scanner selection

## Proposed Solution

Reorganize the Machine Configuration page to place "Bloom API Credentials" as the **first section** at the top of the form, followed by Machine Identity, then Hardware settings.

### New Section Order

1. **Bloom API Credentials** (moved to top)
   - Username (email)
   - Password
   - Anon Key
   - API URL

2. **Machine Identity** (stays second)
   - Scanner Name (dropdown - populated after credentials are entered)

3. **Hardware** (stays third)
   - Camera IP Address
   - Scans Directory

### Benefits

- **Clear dependency flow**: Credentials first → enables scanner dropdown
- **Improved first-run experience**: Users immediately see what they need to configure
- **Reduced scrolling**: Linear top-to-bottom form completion
- **Better mental model**: "Authenticate first, then configure machine"

## Scope

### In Scope

- Reorder sections in MachineConfiguration.tsx component
- Update component tests to reflect new section order
- Maintain all existing functionality (no behavior changes)
- Keep existing validation, error handling, and state management

### Out of Scope

- Changing field validation rules
- Modifying API integration
- Adding new fields or removing existing fields
- Changing visual styling beyond section reordering

## Dependencies

- Existing Machine Configuration UI (Issue #49)
- Scanner name validation feature (already implemented)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tests may fail due to changed DOM order | Medium | Update tests to query by label/role instead of DOM position |
| Users familiar with old layout may be briefly confused | Low | Layout change is intuitive and follows logical flow |

## Success Criteria

- All existing tests pass with updated section order
- No functional behavior changes
- Form completion follows top-to-bottom flow
- Scanner dropdown is enabled after credentials are entered

## Related Issues

- Issue #49: Machine Configuration UI
- Scanner name validation feature
