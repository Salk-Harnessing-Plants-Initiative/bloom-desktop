## Why

Researchers need to browse, view, and manage their captured scans beyond the current day's captures. The existing CaptureScan page only shows recent scans with limited functionality. Without dedicated browse and preview pages, users cannot:

- Review scan quality before analysis
- Navigate through historical scans across experiments
- Delete unwanted or failed scans
- Upload scans to remote Bloom storage for backup and analysis

This is a critical gap for production use, blocking the transition from pilot to production (Issue #1, Phase 6).

**Related Issues:**

- #45 - BrowseScans page (primary)
- #46 - ScanPreview page (primary)
- #78 - Cloud Upload for Scan Images (included in this proposal)
- #77 - Export Page for Batch Scan Export (separate proposal - exports to external directory)
- #1 - Epic: Migration from pilot

## What Changes

**New Pages:**

- **BrowseScans** (`/browse-scans`): Paginated table of all scans with filtering, delete, and upload
- **ScanPreview** (`/scan/:scanId`): Individual scan viewer with image navigation, zoom/pan, and metadata

**New IPC Handlers:**

- `db:scans:list` - Paginated scan listing with filters ✅ IMPLEMENTED
- `db:scans:delete` - Soft delete scan (sets `deleted=true`) ✅ IMPLEMENTED
- `db:scans:upload` - Upload scan to Bloom remote storage
- `db:scans:uploadBatch` - Batch upload with progress tracking

**New Components:**

- `BrowseScans.tsx` - Main page component ✅ IMPLEMENTED
- `ScanPreview.tsx` - Image viewer page
- `ZoomableImage.tsx` - Zoom/pan image component
- `UploadProgress.tsx` - Upload status indicator

**Quick Fixes for Feature Parity:**

- View Scans button navigation from CaptureScan page
- Accession column in BrowseScans table
- Plant ID clickable (link to ScanPreview)

**Database:**

- No schema changes required (existing models are sufficient)
- Soft delete uses existing `Scan.deleted` boolean field
- Upload tracking uses existing `Image.status` field (PENDING, UPLOADING, UPLOADED, FAILED)
- Per-scan upload progress derived from Image statuses

## Current Implementation Status

### Phase 1: Database IPC Handlers ✅ COMPLETE

- Paginated `db:scans:list` with experiment/date filters
- Soft delete `db:scans:delete`
- Timezone-correct date filtering (fixed bug where same-day filters failed)

### Phase 2-3: BrowseScans Page ✅ MOSTLY COMPLETE

- Table with pagination (10/25/50/100 per page)
- Experiment and date range filters
- Delete button with confirmation
- Upload status display

**Missing:**

- Accession column
- Plant ID clickable (requires Phase 4)
- URL query param persistence for filters
- View Scans button navigation from CaptureScan

### Phase 4: ScanPreview Page - NOT STARTED

### Phase 5: Upload to Bloom Storage - NOT STARTED

### Phase 6: Polish - NOT STARTED

## Impact

- **Affected specs**: `ui-management-pages` (adding BrowseScans and ScanPreview requirements)
- **Affected code**:
  - `src/renderer/` - New page components
  - `src/main/database-handlers.ts` - New IPC handlers for scan list/delete
  - `src/main/image-uploader.ts` - New upload service (matches pilot's `imageuploader.ts`)
  - `src/main/preload.ts` - Expose new IPC methods
  - `src/renderer/App.tsx` - Add routes
  - `src/renderer/Layout.tsx` - Add navigation links
  - `src/renderer/CaptureScan.tsx` - Fix View Scans button navigation
- **Related Issues**:
  - #45 - BrowseScans page (primary)
  - #46 - ScanPreview page (primary)
  - #78 - Cloud Upload (included)
  - #1 - Epic: Migration from pilot
- **Out of Scope**: #77 (Export page) - will be a separate proposal
- **Dependencies**: Existing Prisma schema, `@salk-hpi/bloom-js` for Supabase upload
- **Pilot References**:
  - `bloom-desktop-pilot/app/src/renderer/BrowseScans.tsx`
  - `bloom-desktop-pilot/app/src/renderer/ScanPreview.tsx`
  - `bloom-desktop-pilot/app/src/main/imageuploader.ts`
