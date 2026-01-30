# Design: Improve Machine Configuration UX

## Overview

Reorder sections in the Machine Configuration page to place Bloom API Credentials at the top, improving the logical flow and user experience.

## Current Layout

```
┌─────────────────────────────────────────────┐
│  Machine Configuration                      │
├─────────────────────────────────────────────┤
│  Machine Identity                           │
│  ┌─────────────────────────────────────┐   │
│  │ Scanner Name (dropdown - disabled)  │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  Hardware                                   │
│  ┌─────────────────────────────────────┐   │
│  │ Camera IP Address                   │   │
│  │ Scans Directory                     │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  Bloom API Credentials  ← User scrolls here │
│  ┌─────────────────────────────────────┐   │
│  │ Username                            │   │
│  │ Password                            │   │
│  │ Anon Key                            │   │
│  │ API URL                             │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Save Configuration]                       │
└─────────────────────────────────────────────┘
```

### Problems
1. Scanner dropdown appears first but requires credentials (bottom)
2. User must scroll down → enter credentials → scroll up → select scanner
3. First-run UX shows disabled fields without context

## New Layout

```
┌─────────────────────────────────────────────┐
│  Machine Configuration                      │
├─────────────────────────────────────────────┤
│  Bloom API Credentials  ← Start here        │
│  ┌─────────────────────────────────────┐   │
│  │ Username                            │   │
│  │ Password                            │   │
│  │ Anon Key                            │   │
│  │ API URL                             │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  Machine Identity                           │
│  ┌─────────────────────────────────────┐   │
│  │ Scanner Name (dropdown - enabled)   │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  Hardware                                   │
│  ┌─────────────────────────────────────┐   │
│  │ Camera IP Address                   │   │
│  │ Scans Directory                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [Save Configuration]                       │
└─────────────────────────────────────────────┘
```

### Benefits
1. Top-to-bottom flow: Credentials → Scanner → Hardware
2. Scanner dropdown enabled after user enters credentials
3. Clear dependency: "Configure credentials to enable scanner selection"

## Implementation Approach

### Component Structure Change

**Current order in MachineConfiguration.tsx:**
```tsx
<form>
  {/* Machine Identity */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Machine Identity</h2>
    {/* Scanner Name dropdown */}
  </div>

  {/* Hardware Section */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Hardware</h2>
    {/* Camera IP, Scans Dir */}
  </div>

  {/* Bloom API Credentials */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Bloom API Credentials</h2>
    {/* Username, Password, Anon Key, API URL */}
  </div>
</form>
```

**New order:**
```tsx
<form>
  {/* Bloom API Credentials */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Bloom API Credentials</h2>
    {/* Username, Password, Anon Key, API URL */}
  </div>

  {/* Machine Identity */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Machine Identity</h2>
    {/* Scanner Name dropdown */}
  </div>

  {/* Hardware Section */}
  <div className="bg-white p-6 rounded-lg shadow">
    <h2>Hardware</h2>
    {/* Camera IP, Scans Dir */}
  </div>
</form>
```

### No State Changes Required

- All existing state variables remain unchanged
- No changes to `fetchScanners()` logic
- No changes to validation or save functionality
- Scanner dropdown state logic remains the same

### Test Updates Required

Tests may need updates for:
1. Section order verification
2. Form field traversal (tab order)
3. Accessibility tree order

**Strategy**: Query by label/role instead of DOM position to make tests resilient to reordering.

## Visual Design

No visual changes to individual sections - only their vertical order changes:

1. Same card styling (white background, rounded corners, shadow)
2. Same section headers (h2 with gray text)
3. Same input field styling
4. Same spacing between sections

## Accessibility Considerations

- **Tab order**: Top-to-bottom follows logical completion flow
- **Screen readers**: Credentials announced first, matching visual order
- **Keyboard navigation**: Linear progression through form
- **Focus management**: Unchanged (first field in first section gets focus)

## User Flow Comparison

### Before (Current)
1. Load page → see disabled scanner dropdown
2. Wonder why dropdown is disabled
3. Scroll down to find credentials section
4. Enter credentials
5. Scroll back up to select scanner
6. Scroll down to configure hardware
7. Scroll down to save

### After (Proposed)
1. Load page → see credentials section first
2. Enter credentials (clear call-to-action)
3. Continue down → select scanner (now enabled)
4. Continue down → configure hardware
5. Continue down → save

**Result**: Linear top-to-bottom flow with no backtracking.

## Edge Cases

### First-Run Flow
- **Before**: User sees "Enter credentials first" message in scanner section before seeing credentials section
- **After**: User sees credentials section first, then scanner section with contextual message

### Existing Configuration
- **Before**: User sees pre-populated scanner, then scrolls down to see masked credentials
- **After**: User sees masked credentials first, then scanner selection

**Both flows work better with credentials-first ordering.**

## Testing Strategy

### Unit Tests
1. Verify section order in DOM
2. Verify form field order for accessibility
3. Verify scanner fetch trigger (unchanged behavior)
4. Verify validation (unchanged behavior)
5. Verify save functionality (unchanged behavior)

### Manual Testing
1. First-run experience (no credentials)
2. Returning user experience (credentials exist)
3. Form completion flow
4. Keyboard navigation (tab order)
5. Screen reader announcement order

## Rollback Plan

If issues arise, rollback is simple:
1. Revert JSX section order in MachineConfiguration.tsx
2. Revert test updates

No database or API changes involved.
