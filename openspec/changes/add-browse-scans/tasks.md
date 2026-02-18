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

## Phase 2: BrowseScans Page (UI) - PARTIALLY COMPLETE

### 2.1 Write E2E Tests for Navigation

**RED** - Create `tests/e2e/browse-scans.e2e.ts`:

- [ ] Test: Navigate to `/browse-scans` via sidebar link "Browse Scans"
- [ ] Test: Page displays "Browse Scans" heading
- [ ] Test: Empty state shows "No scans found" when no scans exist

### 2.2 Implement Navigation Foundation ✅

**GREEN** - Make tests pass:

- [x] Add route `/browse-scans` to `src/renderer/App.tsx`
- [x] Add "Browse Scans" link to `src/renderer/Layout.tsx` navigation
- [x] Create `src/renderer/BrowseScans.tsx` with empty state

### 2.3 Write E2E Tests for Scans Table

**RED** - Add tests:

- [ ] Test: Table displays scans when they exist (create via Prisma in test)
- [ ] Test: Table columns: Plant ID, Accession, Experiment, Date, Phenotyper, Wave, Age, Images, Upload Status
- [ ] Test: Plant ID is clickable and links to `/scan/:scanId`

### 2.4 Implement Scans Table ✅ (PARTIAL - missing Accession column, Plant ID not clickable)

**GREEN** - Make tests pass:

- [x] Create table in `BrowseScans.tsx`
- [x] Load scans via `window.electron.database.scans.list()`
- [ ] **TODO**: Add Accession column to table
- [ ] **TODO**: Make Plant ID clickable (link to `/scan/:scanId`)

### 2.5 Write E2E Tests for Pagination

**RED** - Add tests:

- [ ] Test: Pagination shows "Showing X of Y scans"
- [ ] Test: Next/Previous/First/Last buttons navigate pages
- [ ] Test: Page size can be changed (10, 25, 50, 100)

### 2.6 Implement Pagination ✅

**GREEN** - Make tests pass:

- [x] Add pagination controls to `BrowseScans.tsx`
- [ ] **TODO**: Integrate with URL query params for state persistence

### 2.7 Write E2E Tests for Filters

**RED** - Add tests:

- [ ] Test: Experiment filter dropdown shows all experiments
- [ ] Test: Filtering by experiment updates table
- [ ] Test: Date range filter works (from/to)
- [ ] Test: Clear filters button resets all filters

### 2.8 Implement Filters ✅

**GREEN** - Make tests pass:

- [x] Add experiment dropdown filter
- [x] Add date range inputs (from/to)
- [x] Add Clear Filters button
- [ ] **TODO**: URL query param sync for filter persistence

---

## Phase 2.5: Quick Fixes for Feature Parity

These are small fixes needed to complete BrowseScans feature parity before moving to ScanPreview.

### 2.5.1 View Scans Button Navigation

**Issue**: The "View All Scans →" button in `RecentScansPreview` on CaptureScan page currently logs `console.log('View all scans (future feature)')` instead of navigating.

**File**: `src/renderer/CaptureScan.tsx` line 663

**RED** - Add E2E test to `tests/e2e/browse-scans.e2e.ts`:

```typescript
test('should navigate to Browse Scans from CaptureScan View All button', async () => {
  // Navigate to CaptureScan page
  await page.click('text=Capture Scan');
  await expect(page).toHaveURL('/capture-scan');

  // Click "View All Scans" button in RecentScansPreview
  await page.click('text=View All Scans');

  // Should navigate to Browse Scans
  await expect(page).toHaveURL('/browse-scans');
  await expect(page.locator('h1')).toHaveText('Browse Scans');
});
```

- [ ] Test: Navigate to CaptureScan page
- [ ] Test: Click "View All Scans →" button
- [ ] Test: Verify URL changes to `/browse-scans`
- [ ] Test: Verify Browse Scans page heading is visible

**GREEN** - Implementation:

- [ ] Import `useNavigate` in `CaptureScan.tsx`
- [ ] Create `navigate` instance: `const navigate = useNavigate();`
- [ ] Update `onViewAll` prop: `onViewAll={() => navigate('/browse-scans')}`

### 2.5.2 Add Accession Column to BrowseScans Table

**Issue**: The `accession_name` field exists in the Scan model but is not displayed in the table. The pilot shows Accession in the scan list.

**File**: `src/renderer/BrowseScans.tsx`

**RED** - Add E2E test to `tests/e2e/browse-scans.e2e.ts`:

```typescript
test('should display Accession column in scans table', async () => {
  // Seed a scan with accession_name
  await prisma.scan.create({
    data: {
      // ... other fields
      accession_name: 'ACC-001',
    },
  });

  // Navigate to Browse Scans
  await page.click('text=Browse Scans');

  // Verify Accession column header exists
  await expect(page.locator('th:has-text("Accession")')).toBeVisible();

  // Verify accession value is displayed in row
  await expect(page.locator('td:has-text("ACC-001")')).toBeVisible();
});

test('should display dash when accession_name is null', async () => {
  // Seed a scan without accession_name
  await prisma.scan.create({
    data: {
      // ... other fields
      accession_name: null,
    },
  });

  // Navigate and verify dash is shown
  await page.click('text=Browse Scans');
  const row = page.locator('tr').filter({ hasText: 'PLANT-ID' });
  await expect(row.locator('td').nth(1)).toHaveText('-'); // Accession column
});
```

- [ ] Test: Accession column header "Accession" is visible in table
- [ ] Test: Accession value displays when `accession_name` is set
- [ ] Test: Shows "-" when `accession_name` is null

**GREEN** - Implementation:

- [ ] Add `<th>` for "Accession" after "Plant ID" column
- [ ] Add `<td>` displaying `scan.accession_name || '-'`

### 2.5.3 Make Plant ID Clickable (Link to ScanPreview)

**Issue**: Plant ID in BrowseScans table should link to ScanPreview page at `/scan/:scanId`.

**Note**: This requires Phase 4 (ScanPreview route) to be partially implemented first. The route must exist even if the page is a placeholder.

**File**: `src/renderer/BrowseScans.tsx`

**RED** - Add E2E test to `tests/e2e/browse-scans.e2e.ts`:

```typescript
test('should navigate to ScanPreview when clicking Plant ID', async () => {
  // Seed a scan
  const scan = await prisma.scan.create({
    data: {
      plant_id: 'PLANT-CLICK-TEST',
      // ... other fields
    },
  });

  // Navigate to Browse Scans
  await page.click('text=Browse Scans');

  // Click on Plant ID link
  await page.click('text=PLANT-CLICK-TEST');

  // Should navigate to scan preview
  await expect(page).toHaveURL(`/scan/${scan.id}`);
});

test('Plant ID should be styled as a link', async () => {
  // Seed a scan
  await prisma.scan.create({
    data: { plant_id: 'PLANT-LINK-STYLE', /* ... */ },
  });

  await page.click('text=Browse Scans');

  // Plant ID should have link styling (blue, underline on hover)
  const plantIdLink = page.locator('a:has-text("PLANT-LINK-STYLE")');
  await expect(plantIdLink).toBeVisible();
  await expect(plantIdLink).toHaveCSS('color', /blue|rgb\(37, 99, 235\)/);
});
```

- [ ] Test: Clicking Plant ID navigates to `/scan/:scanId`
- [ ] Test: Plant ID is rendered as `<Link>` or `<a>` element
- [ ] Test: Plant ID has link styling (blue color, underline on hover)

**GREEN** - Implementation:

- [ ] Import `Link` from `react-router-dom` in `BrowseScans.tsx`
- [ ] Wrap Plant ID cell content in `<Link to={`/scan/${scan.id}`}>`
- [ ] Add styling: `className="text-blue-600 hover:text-blue-800 hover:underline"`

**Prerequisite**: Add placeholder route for `/scan/:scanId` in `App.tsx`:
```typescript
<Route path="scan/:scanId" element={<div>Scan Preview (Coming Soon)</div>} />
```

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

## Phase 4: ScanPreview Page

### 4.1 Write E2E Tests for ScanPreview Navigation

**RED** - Create `tests/e2e/scan-preview.e2e.ts`:

- [ ] Test: Navigate to `/scan/:scanId` from BrowseScans table
- [ ] Test: Page displays scan Plant ID in header
- [ ] Test: Back link navigates to `/browse-scans`
- [ ] Test: Non-existent scanId shows error message

### 4.2 Implement ScanPreview Foundation

**GREEN** - Make tests pass:

- [ ] Add route `/scan/:scanId` to `App.tsx`
- [ ] Create `src/renderer/ScanPreview.tsx`
- [ ] Load scan via `window.electron.database.scans.get()`

### 4.3 Write E2E Tests for Image Viewer

**RED** - Add tests:

- [ ] Test: First image displayed by default
- [ ] Test: Frame counter shows "1 / N"
- [ ] Test: Next/Previous buttons navigate frames
- [ ] Test: Frame counter updates on navigation

### 4.4 Implement Image Viewer

**GREEN** - Make tests pass:

- [ ] Create image viewer component
- [ ] Previous/Next navigation
- [ ] Frame counter display
- [ ] Load images from filesystem via `file://` protocol

### 4.5 Write Unit Tests for Zoom Logic

**RED** - Create `tests/unit/zoomable-image.test.ts`:

- [ ] Test: Zoom levels are 1x, 1.5x, 2x, 3x
- [ ] Test: Zoom in increases level (capped at 3x)
- [ ] Test: Zoom out decreases level (minimum 1x)
- [ ] Test: Reset returns to 1x

### 4.6 Implement Zoom

**GREEN** - Make tests pass:

- [ ] Create `src/renderer/components/ZoomableImage.tsx`
- [ ] Zoom in/out buttons
- [ ] Reset/Fit button
- [ ] CSS transform scale

### 4.7 Write E2E Tests for Keyboard Navigation

**RED** - Add tests:

- [ ] Test: Left arrow goes to previous frame
- [ ] Test: Right arrow goes to next frame
- [ ] Test: Home key goes to first frame
- [ ] Test: End key goes to last frame

### 4.8 Implement Keyboard Navigation

**GREEN** - Make tests pass:

- [ ] Add keyboard event listeners
- [ ] Handle arrow keys, Home, End

### 4.9 Write E2E Tests for Metadata Display

**RED** - Add tests:

- [ ] Test: Metadata panel shows Plant ID, Accession, Experiment
- [ ] Test: Metadata shows camera settings (exposure, gain, gamma)
- [ ] Test: Metadata shows capture date and phenotyper

### 4.10 Implement Metadata Panel

**GREEN** - Make tests pass:

- [ ] Create `src/renderer/components/ScanMetadata.tsx`
- [ ] Display all scan metadata fields

---

## Phase 5: Upload to Bloom Storage

### 5.1 Write Unit Tests for Upload Service

**RED** - Create `tests/unit/image-uploader.test.ts`:

- [ ] Test: Upload service authenticates with Supabase
- [ ] Test: Upload updates Image.status to "uploading"
- [ ] Test: Successful upload sets Image.status to "uploaded"
- [ ] Test: Failed upload sets Image.status to "failed"
- [ ] Test: Upload continues on individual image failure

### 5.2 Implement Upload Service

**GREEN** - Make tests pass:

- [ ] Create `src/main/image-uploader.ts`
- [ ] Use `@salk-hpi/bloom-js` SupabaseStore
- [ ] Authenticate with credentials from `~/.bloom/.env`
- [ ] Update Image.status during upload

### 5.3 Write Integration Tests for Upload IPC

**RED** - Add tests to `renderer-database-ipc.e2e.ts`:

- [ ] Test: `db:scans:upload` returns success for valid scan
- [ ] Test: `db:scans:upload` emits progress events
- [ ] Test: `db:scans:uploadBatch` handles multiple scans

### 5.4 Implement Upload IPC Handlers

**GREEN** - Make tests pass:

- [ ] Add `db:scans:upload` IPC handler
- [ ] Add `db:scans:uploadBatch` IPC handler
- [ ] Emit `scans:upload-progress` events

### 5.5 Write E2E Tests for Upload UI

**RED** - Add tests:

- [ ] Test: Upload button visible in ScanPreview
- [ ] Test: Upload button visible in table row actions
- [ ] Test: Upload shows progress indicator
- [ ] Test: Upload status column shows state (Not uploaded, Uploading, Uploaded)

### 5.6 Implement Upload UI

**GREEN** - Make tests pass:

- [ ] Add upload button to ScanPreview
- [ ] Add upload button to table rows
- [ ] Create `UploadProgress.tsx` component
- [ ] Add upload status column to table

### 5.7 Write E2E Tests for Batch Upload

**RED** - Add tests:

- [ ] Test: Checkbox selection in table rows
- [ ] Test: "Upload Selected" button appears when rows selected
- [ ] Test: Batch upload shows overall progress
- [ ] Test: Batch continues when individual upload fails

### 5.8 Implement Batch Upload

**GREEN** - Make tests pass:

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

| File | Type | Purpose |
|------|------|---------|
| `tests/e2e/browse-scans.e2e.ts` | E2E | BrowseScans page UI workflows |
| `tests/e2e/scan-preview.e2e.ts` | E2E | ScanPreview page UI workflows |
| `tests/unit/zoomable-image.test.ts` | Unit | Zoom logic isolated tests |
| `tests/unit/image-uploader.test.ts` | Unit | Upload service logic |
| Updates to `renderer-database-ipc.e2e.ts` | Integration | Scans IPC handler tests |