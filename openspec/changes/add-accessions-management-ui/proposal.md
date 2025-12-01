# Add Accessions Management UI

## Why

### Problem Statement

Accessions are fully implemented in the database backend (schema, IPC handlers, types) but have **no UI for management**. Users cannot:
- View existing accessions
- Create new accessions
- Upload plant-accession mappings from Excel files
- See which experiments are linked to accessions

This forces users to manually manage accessions via database tools or skip accession tracking entirely, reducing data quality and traceability.

### User Impact

**Current workflow (broken)**:
1. User wants to track plant accessions for an experiment
2. No UI exists to create/view accessions
3. User either skips accession tracking or uses external database tools
4. Data integrity suffers, experiment context is lost

**Desired workflow (with this change)**:
1. User navigates to Accessions page
2. Views list of existing accessions
3. Creates new accession with name
4. Uploads Excel file mapping plant barcodes to genotype IDs
5. Links accessions to experiments in CaptureScan
6. Full traceability from scan → experiment → accession → plant genotype

### Pilot Features to Incorporate

The pilot (`eberrigan/bloom-desktop-pilot`) has a sophisticated Accessions UI with:
- Excel file upload (drag-and-drop, 15MB limit)
- Multi-sheet support with sheet selection
- Column mapping (Plant ID barcode column + Genotype ID column)
- File preview (first 20 rows)
- Visual column highlighting (green for Plant ID, blue for Genotype ID)
- Expandable accession list showing linked experiments
- Inline editing of accession names
- Save/cancel with keyboard shortcuts (Enter/Escape)
- 100-row batch processing throttle
- Info tooltips for user guidance

### Improvements Over Pilot

**Code Quality**:
- TypeScript strict mode throughout (pilot has mixed types)
- Zod validation for file format and column selection
- Comprehensive error handling with user-friendly messages
- Test coverage: 20+ E2E tests, 15+ unit tests (pilot has minimal tests)

**UX Improvements**:
- Accessible drag-and-drop (keyboard support)
- Loading states for all async operations
- Empty state messaging
- Better error recovery (allow retry without losing selections)
- Responsive table with virtual scrolling for large files
- Column type auto-detection (suggest Plant ID vs Genotype columns)

**Performance**:
- Streaming file parsing (not blocking UI)
- Web Worker for Excel processing
- Optimistic UI updates
- Debounced search/filter

## What Changes

### New UI Components

**Files Created**:
- `src/renderer/Accessions.tsx` - Main page component (~300 lines)
- `src/renderer/components/AccessionForm.tsx` - Name input form (~100 lines)
- `src/renderer/components/AccessionFileUpload.tsx` - Excel upload widget (~400 lines)
- `src/renderer/components/AccessionList.tsx` - List with expand/collapse (~200 lines)
- `tests/fixtures/accessions.ts` - Test data factory (~150 lines)
- `tests/e2e/accessions-management.e2e.ts` - E2E tests (~600 lines)
- `tests/unit/components/AccessionForm.test.tsx` - Unit tests (~200 lines)
- `tests/unit/components/AccessionFileUpload.test.tsx` - Upload tests (~400 lines)

**Files Modified**:
- `src/renderer/App.tsx` - Add `/accessions` route
- `src/renderer/Layout.tsx` - Add Accessions navigation link
- `tests/unit/setup.ts` - Add accessions mock to global test setup

### Feature Breakdown

#### Phase 1: Basic CRUD (MVP)
- Display accessions list (sorted alphabetically by name)
- Create accession with name validation
- Empty state when no accessions exist
- Loading/error states

#### Phase 2: Excel File Upload
- Drag-and-drop Excel upload (XLSX/XLS, 15MB limit)
- File validation (format, size, structure)
- Sheet selection dropdown (for multi-sheet files)
- File preview table (first 20 rows)
- Column selection dropdowns (Plant ID + Genotype ID)
- Visual column highlighting in preview
- Upload progress indicator
- Batch processing (100 rows at a time)

#### Phase 3: Accession Management
- Expandable list items showing:
  - Accession name + creation date
  - Number of plant mappings
  - Linked experiments (if any)
- Inline name editing with save/cancel
- Keyboard shortcuts (Enter = save, Escape = cancel)
- Delete accession (with confirmation)

#### Phase 4: Polish
- Info tooltips explaining each field
- Accessible keyboard navigation
- Search/filter accessions
- Export accession mappings to Excel

### Backend Already Complete

No backend changes needed:
- ✅ Database schema (`Accessions` + `PlantAccessionMappings`)
- ✅ IPC handlers (`list`, `create`)
- ✅ Type definitions
- ✅ Unit tests for database operations

**Additional IPC handler needed**:
- `db:accessions:createWithMappings` - Atomic create accession + plant mappings
- `db:accessions:getMappings` - Fetch plant mappings for an accession
- `db:accessions:update` - Update accession name
- `db:accessions:delete` - Delete accession (cascade plant mappings)

## Impact

### On Development Workflow

**Positive**:
- Follows proven TDD pattern (Scientists, Phenotypers)
- Reuses existing UI components (form patterns, loading states)
- Comprehensive test coverage prevents regressions
- Excel parsing library already in dependencies

**Effort**: ~2-3 days with TDD
- Day 1: Fixtures, E2E tests, unit tests (write tests first)
- Day 2: Implement basic CRUD + file upload components
- Day 3: Inline editing, polish, integration testing

### On User Experience

**Before**: No way to manage accessions in UI
**After**: Full-featured accession management with Excel bulk upload

**Key UX Wins**:
- Drag-and-drop file upload (familiar pattern)
- Visual column highlighting (reduces errors)
- Preview before upload (catch mistakes early)
- Keyboard shortcuts (power user efficiency)
- Comprehensive error messages (self-service)

### On Testing

**Test Strategy**:
- **E2E Tests** (~20 scenarios):
  - Navigation and empty state
  - Create accession with valid/invalid names
  - File upload: valid Excel files
  - File upload: invalid files (wrong format, too large, missing columns)
  - Sheet selection for multi-sheet files
  - Column mapping and highlighting
  - Preview data rendering
  - Batch upload progress
  - Expandable list interactions
  - Inline editing with save/cancel
  - Delete with confirmation
  - Keyboard shortcuts
  - Error recovery

- **Unit Tests** (~15 scenarios):
  - AccessionForm validation (name required, max length)
  - AccessionFileUpload file validation
  - Excel parsing (various formats)
  - Column detection/suggestion
  - Preview table rendering
  - Batch processing logic

### On Performance

**Optimizations**:
- Web Worker for Excel parsing (non-blocking)
- Virtual scrolling for large file previews
- Debounced search (300ms)
- Batch database inserts (100 rows at a time)
- Optimistic UI updates for name edits

**Expected performance**:
- Upload 1000-row Excel file: ~2-3 seconds
- Render preview: <100ms
- Search/filter: <50ms

## Related

### Dependencies

None - backend is complete, UI is standalone

### Blocks

This change unblocks:
- Issue #66 - Experiments Management (experiments can link to accessions)
- Issue #68 - AccessionChooser component (needs accessions list to choose from)
- Future: Scan filtering by accession

### Reference

- Pilot Accessions UI: `eberrigan/bloom-desktop-pilot/app/src/renderer/Accessions.tsx`
- Database schema: `prisma/schema.prisma` (lines 39-54)
- IPC handlers: `src/main/database-handlers.ts` (lines 246-283)
- Similar pattern: Scientists Management (PR #64), Phenotypers Management (PR #65)