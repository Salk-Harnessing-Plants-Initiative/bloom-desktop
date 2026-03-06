## Why

`Image.status` is an untyped `String` in the Prisma schema, which allowed a casing mismatch (`'CAPTURED'` vs `'pending'`) to go undetected until manual testing (PR #92). A TypeScript union type will catch status mismatches at compile time, preventing silent data corruption.

## What Changes

- Add `ImageStatus` union type (`'pending' | 'uploading' | 'uploaded' | 'failed'`) to `src/types/database.ts`
- Annotate status parameters and variables in `scanner-process.ts` and `image-uploader.ts` (write-side only; renderer reads use Prisma's `string` type)
- Type the `MockImage.status` field in `tests/unit/image-uploader.test.ts`
- No database migration required (Prisma schema remains `String`)
- No runtime behavior changes

## Impact

- Affected specs: upload
- Affected code: `src/types/database.ts`, `src/main/scanner-process.ts`, `src/main/image-uploader.ts`, `tests/unit/image-uploader.test.ts`
