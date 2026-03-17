# Change Proposal: Fix Scanner Event Listener Memory Leak

## Why

The CaptureScan component has a critical memory leak causing duplicate scan entries in the UI:

1. **Event listener accumulation**: The useEffect at line 173 registers scanner event listeners (`onProgress`, `onComplete`, `onError`) every time `metadata.plantQrCode` changes (user types in the Plant QR Code field)

2. **No cleanup function**: The useEffect has no return statement to remove listeners when dependencies change, causing listeners to accumulate

3. **Duplicate UI entries**: When a scan completes, ALL accumulated listeners fire, each one adding the same scan to `recentScans` array, resulting in multiple identical entries displayed to the user

4. **Scientific reproducibility impact**: This makes it impossible to reliably test the application - the number of duplicates depends on how many times the user edited the Plant QR Code field before scanning

**Observable symptoms:**

- User scans 3 plants, sees 6-8 entries in "Recent Scans Today"
- Each scan appears multiple times with identical data
- Number of duplicates varies based on user interaction patterns

**Additional issues found:**

- Duplicate scan check useEffect (line 79) polls every 2 seconds without cleanup
- Pattern violates React best practices for event listener management

## What Changes

**Event Listener Cleanup (Primary Fix):**

- Update scanner event listeners to return cleanup functions (following `camera.onFrame` pattern)
- Modify preload.ts scanner API to match camera.onFrame implementation
- Add cleanup return statement to CaptureScan useEffect
- Remove `metadata.plantQrCode` from useEffect dependencies (captured in closure when scan starts)

**Polling Cleanup (Secondary Fix):**

- Add cleanup to duplicate scan check useEffect
- Clear interval when component unmounts or dependencies change

**Type System Updates:**

- Update ScannerAPI interface to reflect cleanup functions
- Ensure type safety for event listener removal

**No breaking changes** - this is a pure bug fix with no API changes visible to users.

## Impact

**Affected specs:**

- `scanning` - Event listener lifecycle, scan completion handling

**Affected code:**

- `src/main/preload.ts` - Scanner event listener implementations (add cleanup functions)
- `src/types/scanner.ts` - ScannerAPI interface (update return types)
- `src/types/electron.d.ts` - ScannerAPI interface (update return types)
- `src/renderer/CaptureScan.tsx` - useEffect cleanup, dependency array

**User impact:**

- Fixes duplicate scan entries in "Recent Scans Today" UI
- Prevents memory leaks during extended scanning sessions
- Improves scientific reproducibility (consistent, predictable behavior)
- No visible API changes - existing code continues to work
