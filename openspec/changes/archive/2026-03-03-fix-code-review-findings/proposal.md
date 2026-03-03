## Why

PR #92 code review identified 5 bugs/code quality issues that should be fixed before merge. These affect data integrity (image status casing mismatch), security (innerHTML bypass), correctness (stale closure, date parsing), and production observability (unguarded console.log).

**Related Issues:**

- PR #92 - Browse Scans feature (code review findings)
- #93 - webSecurity: false (deferred, separate issue)
- #95 - Supabase integer type mismatch (deferred, separate issue)

## What Changes

1. **Image status casing mismatch** (`scanner-process.ts:212`): Scanner saves `status: 'CAPTURED'` but UI filters for lowercase `'uploaded'`/`'failed'`/`'pending'`. The Prisma default is `'pending'`. Fix: use lowercase `'pending'` to match schema default and UI expectations.

2. **Production console.log** (`image-uploader.ts:263,301`): Upload callbacks use `console.log` unconditionally. Fix: gate behind `NODE_ENV !== 'production'` or use `console.debug` for non-error logging.

3. **innerHTML bypass** (`ScanPreview.tsx:328`): Image `onError` handler manipulates DOM directly via `innerHTML`, bypassing React's rendering. Fix: use React state (`imageError`) to conditionally render error message.

4. **Date format validation** (`database-handlers.ts:638-648`): Date filter strings are appended with `'T00:00:00'` without validation. Malformed input could create invalid Date objects. Fix: validate date string format before parsing.

5. **Stale closure in keyboard handler** (`ScanPreview.tsx:61-83`): `useEffect` keyboard handler calls `goToNextFrame`/`goToPreviousFrame` which close over stale state. The dependency array only includes `[scan]` but the handlers reference `currentFrame` indirectly. Fix: use functional state updates and include proper dependencies.

## Impact

- Affected specs: `ui-management-pages` (ScanPreview error handling), `scanning` (image status)
- Affected code:
  - `src/main/scanner-process.ts` - Fix status casing
  - `src/main/image-uploader.ts` - Gate console.log
  - `src/renderer/ScanPreview.tsx` - Fix innerHTML and stale closure
  - `src/main/database-handlers.ts` - Validate date format
- **Deferred to GitHub issues:**
  - `any` types in `image-uploader.ts` (4 instances with eslint-disable)
  - Preload listener cleanup (8 of 12 `on*` methods lack cleanup functions)
  - `webSecurity: false` (#93)
