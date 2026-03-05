## 1. Tests

- [ ] 1.1 Add unit test asserting `ImageStatus` type accepts only valid values (`'pending'`, `'uploading'`, `'uploaded'`, `'failed'`)
- [ ] 1.2 Add compile-time test that invalid status strings (e.g., `'CAPTURED'`) produce a type error
- [ ] 1.3 Update `MockImage.status` in `tests/unit/image-uploader.test.ts` from `string` to `ImageStatus`
- [ ] 1.4 Verify `npx tsc --noEmit` passes with all changes applied

## 2. Implementation

- [ ] 2.1 Define `ImageStatus` union type in `src/types/database.ts`
- [ ] 2.2 Export `ImageStatus` from `src/types/database.ts`
- [ ] 2.3 Use `ImageStatus` for the `status` field in `UploadProgress` interface (`src/main/image-uploader.ts:46`)
- [ ] 2.4 Annotate status string literals in `scanner-process.ts` image creation (line 212)
- [ ] 2.5 Annotate status string literals in `image-uploader.ts` status transitions (lines 253, 290, 309)
- [ ] 2.6 Type the `images` parameter in `getUploadStatus()` in `BrowseScans.tsx` (line 212)
- [ ] 2.7 Type the status comparisons in `ScanPreview.tsx` `getUploadStatus()` (line 152)

## 3. Validation

- [ ] 3.1 Run `npx tsc --noEmit` to confirm compile-time safety
- [ ] 3.2 Run `npm run test:unit` to confirm no regressions
- [ ] 3.3 Run `npx prettier --check` on all changed files
