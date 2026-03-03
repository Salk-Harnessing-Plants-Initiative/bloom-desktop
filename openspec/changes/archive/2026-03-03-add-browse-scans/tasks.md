# TDD Implementation Plan

This plan follows Test-Driven Development (TDD): write tests first (RED), implement to pass (GREEN), then refactor.

**Test Types:**

- **Unit tests** (Vitest): Isolated logic, formatters, utilities - `tests/unit/*.test.ts`
- **Integration tests**: IPC handlers with database - `tests/e2e/renderer-database-ipc.e2e.ts`
- **E2E tests** (Playwright): Complete UI workflows - `tests/e2e/*.e2e.ts`

**Test Patterns Reference:**

- E2E: See `tests/e2e/scientists-management.e2e.ts` for UI workflow pattern
- IPC: See `tests/e2e/renderer-database-ipc.e2e.ts` for IPC handler testing pattern
- Unit: See `tests/unit/database-init.test.ts` for unit test pattern

---

## Phase 1: Database IPC Handlers (Backend First) ✅ COMPLETE

### 1.1 Write Integration Tests for `db:scans:list`

**RED** - Add tests to `tests/e2e/renderer-database-ipc.e2e.ts`:

- [x] Test: `db:scans:list` returns paginated results
- [x] Test: `db:scans:list` excludes soft-deleted scans (deleted: true)
- [x] Test: `db:scans:list` filters by experimentId
- [x] Test: `db:scans:list` filters by date range (dateFrom, dateTo)
- [x] Test: `db:scans:list` filters same-day scans correctly (timezone handling)
- [x] Test: `db:scans:list` includes phenotyper and experiment relations
- [x] Test: `db:scans:list` returns total count for pagination
- [x] Test: `db:scans:list` orders by capture_date descending

### 1.2 Implement `db:scans:list` Handler

**GREEN** - Make tests pass:

- [x] Add `db:scans:list` IPC handler to `src/main/database-handlers.ts`
  - Parameters: `{ page, pageSize, experimentId?, dateFrom?, dateTo? }`
  - Returns: `{ scans: ScanWithRelations[], total: number, page: number, pageSize: number }`
- [x] Expose in `src/main/preload.ts` via contextBridge
- [x] Add TypeScript types to `src/types/electron.d.ts`
- [x] Fix timezone handling: parse date strings as local time, not UTC

### 1.3 Write Integration Tests for `db:scans:get`

**RED** - Add tests:

- [x] Test: `db:scans:get` returns single scan with all relations
- [x] Test: `db:scans:get` includes all images sorted by frame_number
- [x] Test: `db:scans:get` returns null for non-existent scanId

### 1.4 Implement `db:scans:get` Handler

**GREEN** - Make tests pass:

- [x] Add `db:scans:get` IPC handler (already existed)
  - Parameters: `{ scanId: string }`
  - Returns: Scan with images, phenotyper, experiment relations
- [x] Expose in preload.ts

### 1.5 Write Integration Tests for `db:scans:delete`

**RED** - Add tests:

- [x] Test: `db:scans:delete` sets deleted: true (soft delete)
- [x] Test: `db:scans:delete` does NOT delete Image records
- [x] Test: Deleted scan no longer appears in `db:scans:list` results

### 1.6 Implement `db:scans:delete` Handler

**GREEN** - Make tests pass:

- [x] Add `db:scans:delete` IPC handler
  - Parameters: `{ scanId: string }`
  - Sets `deleted: true` via Prisma update
  - Returns `{ success: true }` or error
- [x] Expose in preload.ts

---

## Phase 2: BrowseScans Page (UI) ✅ COMPLETE

### 2.1-2.2 Navigation ✅

- [x] Route `/browse-scans` in `App.tsx`
- [x] "Browse Scans" link in `Layout.tsx` navigation
- [x] `BrowseScans.tsx` with empty state

### 2.3-2.4 Scans Table ✅

- [x] Table with all columns: Plant ID, Accession, Capture Date, Experiment, Phenotyper, Wave, Age, Images, Upload Status, Actions
- [x] Plant ID clickable (links to `/scan/:scanId`)
- [x] Loads scans via `window.electron.database.scans.list()`

### 2.5-2.6 Pagination ✅

- [x] Pagination controls (First, Previous, Next, Last)
- [x] Page size selector (10, 25, 50, 100)
- [x] Shows "Showing X of Y scans"
- [ ] **TODO (Phase 6)**: URL query param persistence

### 2.7-2.8 Filters ✅

- [x] Experiment dropdown filter
- [x] Date range inputs (from/to)
- [x] Clear Filters button
- [ ] **TODO (Phase 6)**: URL query param sync

---

## Phase 2.5: Quick Fixes for Feature Parity ✅ COMPLETE

All quick fixes have been implemented:

- [x] **2.5.1 View Scans Button Navigation**: `CaptureScan.tsx` now uses `useNavigate` to navigate to `/browse-scans`
- [x] **2.5.2 Accession Column**: Added to BrowseScans table after Plant ID column
- [x] **2.5.3 Plant ID Clickable**: Wrapped in `<Link to={/scan/${scan.id}}>` with blue styling
- [x] **2.5.4 View Button**: Added eye icon button in Actions column before Delete
- [x] **Prerequisite**: Placeholder route `/scan/:scanId` added to App.tsx

---

## Phase 3: Delete Functionality ✅ COMPLETE

### 3.1 Write E2E Tests for Delete

**RED** - Add tests:

- [ ] Test: Delete button appears in table row actions
- [ ] Test: Clicking delete shows confirmation dialog
- [ ] Test: Cancel closes dialog without deleting
- [ ] Test: Confirm deletes scan and refreshes table
- [ ] Test: Deleted scan no longer appears in table

### 3.2 Implement Delete ✅

**GREEN** - Make tests pass:

- [x] Add delete button to table rows
- [x] Show confirmation dialog (using `window.confirm`)
- [x] Call `window.electron.database.scans.delete()` on confirm
- [x] Refresh table after delete

---

## Phase 4: ScanPreview Page ✅ COMPLETE

### 4.1-4.2 Navigation & Foundation ✅

**Tests**: `tests/e2e/scan-preview.e2e.ts`

- [x] Navigate to `/scan/:scanId` from BrowseScans table (Plant ID link + View button)
- [x] Page displays scan Plant ID in header
- [x] Back link navigates to `/browse-scans`
- [x] Non-existent scanId shows error message
- [x] Route `/scan/:scanId` in `App.tsx` using `ScanPreview` component
- [x] `src/renderer/ScanPreview.tsx` created
- [x] Loads scan via `window.electron.database.scans.get()`

### 4.3-4.4 Image Viewer ✅

- [x] First image displayed by default (frame 0)
- [x] Frame counter shows "1 / N" format
- [x] Next/Previous buttons navigate frames
- [x] Frame counter updates on navigation
- [x] Shows "No images" when scan has no images
- [x] Loads images via `file://` protocol

### 4.5-4.6 Zoom Controls ✅

- [x] Zoom levels: 1x, 1.5x, 2x, 3x
- [x] Zoom in/out buttons
- [x] Reset/Fit button
- [x] CSS transform scale with smooth transition

### 4.7-4.8 Keyboard Navigation ✅

- [x] Left Arrow → previous frame
- [x] Right Arrow → next frame
- [x] Home → first frame
- [x] End → last frame
- [x] Event listeners with cleanup

### 4.9-4.10 Metadata Panel ✅

- [x] Plant Information: Plant ID, Accession, Wave, Age
- [x] Experiment: Name, Species
- [x] Capture: Date, Phenotyper, Scanner, Total Frames
- [x] Camera Settings: Exposure, Gain, Gamma, Brightness, Contrast

### 4.11 Missing Metadata Fields

**Issue**: The following fields from the database are not displayed in ScanPreview:

1. **Scientist** - Linked to Experiment via `experiment.scientist` relation
2. **Rotation Speed** - `scan.seconds_per_rot` field (seconds per rotation)

**Required Changes:**

1. Update `ScanWithRelations` type to include nested `experiment.scientist`
2. Update `db:scans:get` and `db:scans:list` handlers to include scientist relation
3. Update ScanPreview to display these fields

**RED** - Add tests to `tests/e2e/scan-preview.e2e.ts`:

```typescript
test('should display scientist attached to experiment', async () => {
  await createTestScan({ plant_id: 'PLANT-SCIENTIST-TEST' });
  await window.click('text=Browse Scans');
  await window.click('text=PLANT-SCIENTIST-TEST');

  // Scientist is linked to experiment
  await expect(window.locator('text=Scientist')).toBeVisible();
  await expect(window.locator('text=Test Scientist')).toBeVisible();
});

test('should display rotation speed', async () => {
  await createTestScan({ plant_id: 'PLANT-ROTATION-TEST' });
  await window.click('text=Browse Scans');
  await window.click('text=PLANT-ROTATION-TEST');

  await expect(window.locator('text=Rotation')).toBeVisible();
});
```

- [x] Test: Scientist name displayed in metadata panel
- [x] Test: Rotation speed (seconds_per_rot) displayed

**GREEN** - Implementation:

- [x] Update `ScanWithRelations` type in `src/types/database.ts` to include `experiment.scientist`
- [x] Update `db:scans:get` handler to include scientist
- [x] Update `db:scans:list` handler to include scientist
- [x] Add Scientist row to ScanPreview Experiment section
- [x] Add Rotation Speed row to ScanPreview Capture section

### 4.12 E2E Test Fixes ✅

**Issues discovered during E2E testing:**

1. **MemoryRouter URL assertions** - The app uses `MemoryRouter` which doesn't change browser URLs. Fixed by replacing `toHaveURL()` assertions with element visibility checks.

2. **Image onError null reference** - The `onError` handler in ScanPreview assumed `parentElement` existed. Fixed by adding null check.

3. **Navigation timing** - Tests needed to wait for destination page elements before asserting.

**Documentation:** See `docs/E2E_TESTING.md` Pitfalls 10-11 for detailed explanation.

---

## Phase 5: Upload to Bloom Storage — BLOCKED by #95

> Upload backend is implemented and unit-tested, but end-to-end upload fails due to
> Supabase `insert_image_v3_0` RPC using INTEGER types for float camera settings.
> See: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/95
>
> Upload UI work (5.5-5.8) is deferred until #95 is resolved and upload can be verified.

### 5.1 Write Unit Tests for Upload Service ✅ COMPLETE

**RED** - Create `tests/unit/image-uploader.test.ts`:

- [x] Test: Upload service authenticates with Supabase
- [x] Test: Upload updates Image.status to "uploading"
- [x] Test: Successful upload sets Image.status to "uploaded"
- [x] Test: Failed upload sets Image.status to "failed"
- [x] Test: Upload continues on individual image failure

### 5.2 Implement Upload Service ✅ COMPLETE

**GREEN** - Make tests pass:

- [x] Create `src/main/image-uploader.ts`
- [x] Use `@salk-hpi/bloom-js` SupabaseUploader
- [x] Authenticate with credentials from `~/.bloom/.env`
- [x] Update Image.status during upload

### 5.3 Write Integration Tests for Upload IPC ✅ COMPLETE

**RED** - Add tests to `renderer-database-ipc.e2e.ts`:

- [x] Test: `db:scans:upload` returns error for missing credentials
- [x] Test: `db:scans:upload` returns error for non-existent scan
- [x] Test: `db:scans:uploadBatch` returns error for missing credentials
- [x] Test: Response structure validation

**Note:** Real upload tests require valid Bloom credentials. CI tests verify error handling paths. See `docs/MANUAL_UPLOAD_TESTING.md` for manual testing with real credentials.

### 5.4 Implement Upload IPC Handlers ✅ COMPLETE

**GREEN** - Make tests pass:

- [x] Add `db:scans:upload` IPC handler
- [x] Add `db:scans:uploadBatch` IPC handler
- [x] Add types to `electron.d.ts`
- [x] Expose via `preload.ts`
- [x] Create `docs/MANUAL_UPLOAD_TESTING.md`

**Note:** Progress events deferred - not needed for basic upload functionality.

### 5.5 Upload UI (deferred until #95 resolved)

- [ ] Add upload button to ScanPreview
- [ ] Add upload button to table rows
- [ ] Create `UploadProgress.tsx` component
- [ ] Add upload status column to table

### 5.6 Batch Upload (deferred until #95 resolved)

- [ ] Add row selection checkboxes
- [ ] Add "Upload Selected" button
- [ ] Batch progress indicator
- [ ] Error handling for partial failures

---

## Phase 6: Polish and Edge Cases

### 6.1 Write E2E Tests for Edge Cases

**RED** - Add tests:

- [ ] Test: Loading state shows while fetching scans
- [ ] Test: Error state shows when fetch fails
- [ ] Test: Delete button disabled during upload
- [ ] Test: Filter state preserved in URL across navigation

### 6.2 Implement Edge Cases

**GREEN** - Make tests pass:

- [ ] Loading spinners
- [ ] Error messages
- [ ] Disable delete during upload
- [ ] URL query param persistence

---

## Verification Checklist

Before marking proposal complete:

- [ ] All unit tests pass (`npm run test:unit`)
- [ ] All integration tests pass (`npm run test:ipc`)
- [ ] All E2E tests pass (`npm run test:e2e`)
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Feature parity with pilot BrowseScans/ScanPreview verified manually
- [ ] Upload to Bloom storage tested with real credentials
- [ ] Soft delete verified: files remain on disk
- [ ] Pagination verified with 100+ scans

---

## Test Files to Create

| File                                      | Type        | Purpose                       |
| ----------------------------------------- | ----------- | ----------------------------- |
| `tests/e2e/browse-scans.e2e.ts`           | E2E         | BrowseScans page UI workflows |
| `tests/e2e/scan-preview.e2e.ts`           | E2E         | ScanPreview page UI workflows |
| `tests/unit/zoomable-image.test.ts`       | Unit        | Zoom logic isolated tests     |
| `tests/unit/image-uploader.test.ts`       | Unit        | Upload service logic          |
| Updates to `renderer-database-ipc.e2e.ts` | Integration | Scans IPC handler tests       |
