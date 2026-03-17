# Proposal: Fix Numeric Input Fields on Capture Scan Page

## Summary

Two issues with the numeric input fields (Wave Number and Plant Age) on the Capture Scan page:

1. **Wave number validation incorrectly rejects 0**: The validation requires `waveNumber > 0`, but wave number 0 should be valid (matching pilot behavior)
2. **Cannot clear numeric fields to type new values**: When deleting the current value, the field immediately resets to 0, preventing users from typing a new value

## Motivation

- **Wave number 0**: The pilot allows wave number 0. Some experiments may legitimately start at wave 0.
- **Field clearing**: Users need to be able to clear a field and type a new value directly, rather than using arrow keys or typing after the existing value (e.g., "03" instead of "3").

## Current Behavior

### Wave Number Validation

- Location: [CaptureScan.tsx:339](src/renderer/CaptureScan.tsx#L339)
- Current: `if (metadata.waveNumber <= 0)` shows error "Wave number must be greater than 0"
- Pilot: Only checks if value is `NaN`, allows 0

### Numeric Field Reset Issue

- Location: [MetadataForm.tsx:185-186](src/components/MetadataForm.tsx#L185-L186)
- Current onChange: `parseInt(e.target.value, 10) || 0`
- When user deletes content, `parseInt("")` returns `NaN`, so `|| 0` sets value back to 0
- User cannot clear the field to type a fresh value

### Pilot Behavior

The pilot allows empty values (lines 458-460 of pilot's CaptureScan.tsx):

```tsx
const value = e.target.value === '' ? null : parseInt(e.target.value);
setWaveNumber(value);
```

## Proposed Changes

### 1. Fix Wave Number Validation

Change validation from `waveNumber <= 0` to `waveNumber < 0`:

- Update error message to: "Wave number must be 0 or greater"
- Matches pilot behavior and domain requirements

### 2. Allow Empty Numeric Fields During Editing

Update onChange handlers to allow empty/null state while editing:

- Allow `""` or `null` as intermediate values
- Validation will catch empty values at form submission
- Users can clear and retype values naturally

## Affected Files

1. `src/renderer/CaptureScan.tsx` - Validation logic
2. `src/components/MetadataForm.tsx` - Input onChange handlers
3. `src/components/MetadataForm.tsx` - ScanMetadata type (may need to allow null)

## Scope

- **In scope**: Wave Number and Plant Age fields on Capture Scan page
- **Out of scope**: Other numeric inputs in the app

## Risks

- **Low risk**: Straightforward fix matching pilot behavior
- **Type safety**: May need to handle null values in type definitions
