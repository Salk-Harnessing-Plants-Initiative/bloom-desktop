# Proposal: Add Fetch Scanners Button to Credentials Section

**Status:** Draft
**Author:** AI Assistant
**Created:** 2026-01-28
**Change ID:** add-fetch-scanners-button

## Problem Statement

There is a **catch-22 UX problem** in the Machine Configuration page:

1. **User enters Bloom API credentials** in the credentials section
2. **User wants to select a scanner** from the dropdown in Station Identity section
3. **Scanner dropdown is disabled** with message "Enter credentials first"
4. **User clicks "Save Configuration"** to save credentials
5. **Save fails** because scanner_name is required but user can't select one yet!

**Current workaround (confusing)**:
- Save credentials fails due to validation
- No way to test credentials without completing entire form
- User must manually type a scanner name or refresh page after partial save

**What users expect**:
- Enter credentials → Test/Fetch scanners → Select scanner → Save complete configuration

## Proposed Solution

Add a **"Fetch Scanners from Bloom"** button in the Bloom API Credentials section that:

1. Validates only the credentials fields (not the entire form)
2. Calls `fetchScanners()` using current credential values
3. Shows loading state while fetching
4. Populates scanner dropdown on success
5. Shows error message on failure with retry button

### UI Changes

**Location**: After the Anon Key field in Bloom API Credentials section

**Button states**:
- **Disabled** when any credential field is empty
- **Loading** while fetching (with spinner)
- **Enabled** when all credentials are present

**Success feedback**: "✓ Found N scanners"

**Error handling**: Shows error message with retry option

### Benefits

- **Breaks the catch-22**: Users can test credentials before completing form
- **Immediate feedback**: Know if credentials work before filling other fields
- **Better UX**: Clear action to take after entering credentials
- **Reduces confusion**: Explicit button action vs. implicit "save everything"

## Scope

### In Scope

- Add "Fetch Scanners from Bloom" button to Credentials section
- Validate credentials fields only (not entire form)
- Show loading/success/error states
- Update UI tests for new button
- Update spec scenarios for fetch button behavior

### Out of Scope

- Changing save validation logic
- Modifying scanner fetch implementation
- Auto-fetching on credential change (too aggressive)
- Credential validation beyond "not empty"

## Dependencies

- Supabase authentication (already implemented)
- `fetchScanners()` function (already exists)
- Machine Configuration UI

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users forget to fetch scanners | Low | Keep existing auto-fetch on save as fallback |
| Multiple fetch calls (button + auto) | Low | Loading state prevents duplicate calls |
| Error messages need to be clear | Medium | Use specific error text from API |

## Success Criteria

- Button appears in credentials section
- Button disabled when credentials incomplete
- Clicking button fetches scanners without saving full config
- Loading state shows while fetching
- Scanner dropdown populates on success
- Error message shows on failure
- All tests pass including new button tests

## Test Strategy

1. **Unit tests**: Test button visibility, disabled states, click handler
2. **Integration tests**: Test fetch without save
3. **Manual test**: Complete flow from empty form to scanner selection

## Related Issues

- Supabase authentication implementation
- Machine Configuration UX improvements
