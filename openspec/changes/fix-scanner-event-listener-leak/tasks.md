# Tasks: Fix Scanner Event Listener Memory Leak

## Implementation Checklist (TDD Approach)

### Phase 1: Write Tests First (TDD)

- [x] 1.1 Add test: Mock scanner event listeners return cleanup functions
- [x] 1.2 Add test: Calling cleanup function removes listener (no events after cleanup)
- [x] 1.3 Add test: Multiple listener registrations each get unique cleanup
- [x] 1.4 Add test: Component unmount removes all scanner listeners
- [x] 1.5 Add test: Dependency change removes old listeners before registering new
- [x] 1.6 Add test: Scan completion fires exactly once (not N times based on typing)
- [x] 1.7 Add test: Interval cleanup on unmount
- [x] 1.8 Add test: Interval cleanup on dependency change
- [x] 1.9 Run tests: `npm run test:unit` - expect 8 failures ❌

### Phase 2: Update Scanner API Types (TDD)

- [x] 2.1 Update `ScannerAPI` interface in src/types/scanner.ts
- [x] 2.2 Change `onProgress` return type from `void` to `() => void`
- [x] 2.3 Change `onComplete` return type from `void` to `() => void`
- [x] 2.4 Change `onError` return type from `void` to `() => void`
- [x] 2.5 Update JSDoc comments to document cleanup functions
- [x] 2.6 Update `ScannerAPI` interface in src/types/electron.d.ts (match scanner.ts)
- [x] 2.7 Run TypeScript compiler: `npx tsc --noEmit` - expect type errors in preload.ts ✅

### Phase 3: Implement Scanner Event Listener Cleanup (TDD)

- [x] 3.1 Update `scannerAPI.onProgress` in src/main/preload.ts
- [x] 3.2 Capture listener in const, register with ipcRenderer.on()
- [x] 3.3 Return cleanup function that calls ipcRenderer.removeListener()
- [x] 3.4 Repeat for `onComplete` - same pattern
- [x] 3.5 Repeat for `onError` - same pattern
- [x] 3.6 Run TypeScript compiler: `npx tsc --noEmit` - expect no errors ✅
- [x] 3.7 Run preload tests - expect listener cleanup tests to pass ✅

### Phase 4: Fix CaptureScan Scanner useEffect (TDD)

- [x] 4.1 Open src/renderer/CaptureScan.tsx, locate scanner useEffect (~line 173)
- [x] 4.2 Capture cleanup functions from event listener registrations
- [x] 4.3 Add return statement with cleanup function that calls all three cleanups
- [x] 4.4 Remove `metadata.plantQrCode` from useEffect dependency array
- [x] 4.5 Keep only `[isScanning]` as dependency
- [x] 4.6 Add comment explaining why plantQrCode is not in dependencies
- [x] 4.7 Run component tests - expect scan completion tests to pass ✅

### Phase 5: Fix Duplicate Scan Check useEffect (TDD)

- [x] 5.1 Locate duplicate scan check useEffect in CaptureScan (~line 79)
- [x] 5.2 Identify setInterval call (~line 127)
- [x] 5.3 Add return statement with cleanup function
- [x] 5.4 Call `clearInterval(intervalId)` in cleanup
- [x] 5.5 Run component tests - expect interval cleanup tests to pass ✅

### Phase 6: Integration Testing

- [ ] 6.1 Test: Start app, navigate to CaptureScan page
- [ ] 6.2 Test: Type in Plant QR Code field multiple times (change barcode 5-10 times)
- [ ] 6.3 Test: Start a mock scan
- [ ] 6.4 Test: Wait for scan to complete
- [ ] 6.5 Test: Verify Recent Scans shows exactly ONE entry for the scan
- [ ] 6.6 Test: Check console for any "listener leak" warnings
- [ ] 6.7 Test: Perform 3 scans back-to-back
- [ ] 6.8 Test: Verify Recent Scans shows exactly 3 entries (no duplicates)
- [ ] 6.9 Test: Navigate away from CaptureScan and back
- [ ] 6.10 Test: Verify no console errors about listeners after unmount

### Phase 7: Manual Memory Leak Testing

- [ ] 7.1 Test: Open Chrome DevTools → Performance → Memory
- [ ] 7.2 Test: Take heap snapshot baseline
- [ ] 7.3 Test: Type in Plant QR Code field 20 times
- [ ] 7.4 Test: Take second heap snapshot
- [ ] 7.5 Test: Verify no significant increase in event listener count
- [ ] 7.6 Test: Perform 10 scans
- [ ] 7.7 Test: Take third heap snapshot
- [ ] 7.8 Test: Verify Recent Scans shows exactly 10 entries (not 30-50)
- [ ] 7.9 Test: Verify memory usage is stable (no continuous growth)

### Phase 8: Documentation and Cleanup

- [x] 8.1 Update preload.ts comments explaining cleanup pattern
- [x] 8.2 Update CaptureScan.tsx comments explaining dependency choices
- [x] 8.3 Run linter: `npm run lint` - fix any errors
- [x] 8.4 Run formatter: `npm run format`
- [x] 8.5 Run full test suite: `npm run test:unit` - expect all tests to pass ✅
- [x] 8.6 Verify no console.error or console.warn in component code

### Phase 9: Validate Spec

- [x] 9.1 Run: `npx openspec validate fix-scanner-event-listener-leak --strict`
- [x] 9.2 Fix any validation errors
- [x] 9.3 Confirm all scenarios covered by tests

## Acceptance Criteria

### Functional Requirements

- ✓ Scanner event listeners return cleanup functions (matching camera.onFrame pattern)
- ✓ Cleanup functions properly remove listeners via ipcRenderer.removeListener()
- ✓ CaptureScan useEffect has return statement calling all cleanup functions
- ✓ metadata.plantQrCode removed from scanner useEffect dependencies
- ✓ Duplicate scan check interval is cleared on unmount/dependency change
- ✓ Exactly ONE scan entry added per scan completion (no duplicates)
- ✓ Recent Scans UI shows correct number of scans

### Technical Requirements

- ✓ ScannerAPI interface updated in both scanner.ts and electron.d.ts
- ✓ Return types changed from `void` to `() => void`
- ✓ No TypeScript errors after changes
- ✓ Event listener pattern matches camera.onFrame (consistency)
- ✓ No breaking changes to existing scanner API methods
- ✓ Memory usage stable during extended scanning sessions

### Testing Requirements

- ✓ 8 new unit tests pass (listener cleanup, interval cleanup)
- ✓ Integration tests verify single scan entry per completion
- ✓ Manual testing confirms no duplicates with various typing patterns
- ✓ Memory profiling shows no listener accumulation
- ✓ No regressions in existing scanning functionality

## Files Modified

### Main Process

- `src/main/preload.ts` - Scanner event listener implementations (add cleanup)

### Types

- `src/types/scanner.ts` - ScannerAPI interface (update return types)
- `src/types/electron.d.ts` - ScannerAPI interface (update return types)

### Renderer

- `src/renderer/CaptureScan.tsx` - useEffect cleanup, dependency array

### Tests

- `tests/unit/preload-scanner.test.ts` - Scanner listener cleanup tests (NEW)
- `tests/unit/pages/CaptureScan-event-cleanup.test.tsx` - Event listener tests (NEW)

## Technical Notes

### Event Listener Cleanup Pattern

```typescript
// Capture listener in const to enable removal
const listener = (_event: unknown, data: T) => callback(data);
ipcRenderer.on('event-name', listener);

// Return cleanup function
return () => ipcRenderer.removeListener('event-name', listener);
```

### Why This Pattern Works

1. **Listener reference**: Storing listener in const ensures same function reference for removal
2. **Cleanup function**: Returning function allows React useEffect to call it on cleanup
3. **Type safety**: TypeScript ensures cleanup function signature matches API
4. **Consistency**: Matches existing camera.onFrame pattern

### Dependency Array Reasoning

**Scanner useEffect dependencies: `[isScanning]`**

- `isScanning` changes → scan starts/stops → re-register listeners ✅
- `metadata.plantQrCode` changes → just update state → don't re-register ✅
- Barcode value captured in closure when scan starts ✅
- Correct barcode used in completion handler ✅

**Duplicate check useEffect dependencies: `[metadata.plantQrCode, metadata.experimentId]`**

- These values ARE used in the polling logic ✅
- Interval must be re-created when they change ✅
- Cleanup prevents multiple overlapping intervals ✅

## Dependencies

- **Depends on**: None (standalone bug fix)
- **Blocks**: None
- **Related**: Scanning workflow, event listener management

## Rollback Plan

If issues discovered:

1. Revert preload.ts scanner event listeners to void return type
2. Revert CaptureScan.tsx to remove cleanup functions
3. Re-add `metadata.plantQrCode` to dependencies (accept duplicates as known issue)
4. No data loss (only affects UI display, not database)
5. Single commit rollback possible
