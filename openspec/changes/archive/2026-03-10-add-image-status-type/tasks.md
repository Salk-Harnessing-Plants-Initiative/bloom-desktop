## 1. Tests

- [x] 1.1 Add unit test asserting `ImageStatus` type accepts only valid values (`'pending'`, `'uploading'`, `'uploaded'`, `'failed'`)
- [x] 1.2 Add compile-time test that invalid status strings (e.g., `'CAPTURED'`) produce a type error (validated by Vitest's TS transpilation; `tsconfig.json` excludes `tests/`)
- [x] 1.3 Update `MockImage.status` in `tests/unit/image-uploader.test.ts` from `string` to `ImageStatus`
- [x] 1.4 Verify `npx tsc --noEmit` passes with all changes applied

## 2. Implementation

- [x] 2.1 Define `ImageStatus` union type in `src/types/database.ts`
- [x] 2.2 Export `ImageStatus` from `src/types/database.ts`
- [x] 2.3 Use `ImageStatus` for the `status` field in `UploadProgress` interface (`src/main/image-uploader.ts:46`)
- [x] 2.4 Annotate status string literals in `scanner-process.ts` image creation (line 212)
- [x] 2.5 Annotate status string literals in `image-uploader.ts` status transitions (lines 263, 303, 323)
- [N/A] 2.6 Type the `images` parameter in `getUploadStatus()` in `BrowseScans.tsx` — Prisma schema keeps `status` as `String`, so Prisma-generated types return `string`. Forcing `ImageStatus` on the read side creates friction without benefit; compile-time safety is on the write side.
- [N/A] 2.7 Type the status comparisons in `ScanPreview.tsx` `getUploadStatus()` — same reasoning as 2.6

## 3. Validation

- [x] 3.1 Run `npx tsc --noEmit` to confirm compile-time safety
- [x] 3.2 Run `npm run test:unit` to confirm no regressions
- [x] 3.3 Run `npx prettier --check` on all changed files
