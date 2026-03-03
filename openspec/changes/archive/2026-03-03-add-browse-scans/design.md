## Context

The pilot implementation (`bloom-desktop-pilot`) has working BrowseScans and ScanPreview components that need to be migrated to production. The production codebase has:

- Prisma database with compatible schema
- Established IPC patterns for database operations
- React Router navigation structure
- Tailwind CSS styling conventions
- E2E testing with Playwright

This design ensures feature parity with pilot while improving code quality and testability.

## Goals / Non-Goals

**Goals:**

- Feature parity with pilot BrowseScans and ScanPreview
- Full upload support (single + batch) with progress tracking
- Minimal but useful filtering (date range + experiment)
- Soft delete (preserve data, mark as deleted)
- TDD with E2E tests for critical paths
- Metadata preservation for FAIR principles

**Non-Goals:**

- Advanced filters (phenotyper, scanner, wave number) - defer to follow-up
- CSV/image export - defer to follow-up
- Bulk selection beyond upload/delete - defer to follow-up
- Virtual scrolling for large tables - optimize only if needed
- Thumbnail generation - use existing image paths

## Decisions

### Decision: Soft Delete Pattern

**Choice**: Set `deleted=true` instead of removing database records

**Rationale**:

- Preserves data integrity and audit trail
- Allows recovery from accidental deletion
- Matches pilot behavior
- Database schema already has `deleted` field

### Decision: Pagination Strategy

**Choice**: Server-side pagination with Prisma `skip`/`take`

**Rationale**:

- Handles large datasets efficiently
- Only loads visible rows
- Matches pilot pattern
- Default: 25 items per page

### Decision: Upload Architecture

**Choice**: Use existing `@salk-hpi/bloom-js` SupabaseStore, upload via IPC

**Rationale**:

- Consistent with machine configuration fetch scanners pattern
- Authentication already solved
- Supabase handles file storage
- Progress events via IPC callback

### Decision: Image Viewer Approach

**Choice**: Native `<img>` with CSS transforms for zoom/pan

**Rationale**:

- Simple, no extra dependencies
- Pilot uses this pattern successfully
- Browser handles large images efficiently
- Zoom levels: 1x, 1.5x, 2x, 3x (discrete steps)

### Decision: Filter Persistence

**Choice**: URL query parameters for shareable state

**Rationale**:

- Bookmarkable filtered views
- Back button works naturally
- No local storage needed
- Example: `/scans?experiment=abc&from=2026-01-01&to=2026-01-31`

## Risks / Trade-offs

### Risk: Large image performance

**Mitigation**: Lazy load images, preload adjacent frames, use thumbnail for table

### Risk: Upload failures

**Mitigation**: Retry mechanism, clear error messages, batch continues on individual failure

### Risk: Race conditions during upload

**Mitigation**: Disable delete during upload, optimistic UI updates with rollback

## Migration Plan

This is a new feature, no migration required. Database schema is already compatible.

## Open Questions

1. **Upload destination**: The pilot uses Supabase storage via `@salk-hpi/bloom-js`. Need to confirm the exact bucket/path structure with Bloom API team. (Reference: `bloom-desktop-pilot/app/src/main/imageuploader.ts`)

2. **Thumbnail strategy**: The pilot does not generate thumbnails - it uses the first frame directly. We will follow the same approach: use `Image.path` for the first frame. Optimize later if table performance degrades with many scans.

3. **Upload status tracking**: **RESOLVED** - The `Image.status` field already exists in the schema with values: "pending", "uploading", "uploaded", "failed". Per-scan progress is calculated from image statuses. (Reference: `prisma/schema.prisma:91`)

4. **Export vs Upload**: Export (#77) and Upload (#78) are separate concerns:
   - **Upload**: Sync to Supabase cloud storage (included in this proposal)
   - **Export**: Copy to external directory (USB, network drive) - separate proposal

5. **Real-time updates**: We will use `scans:upload-progress` IPC event to notify renderer of upload progress during batch operations.
