# Add Phenotypers Management UI

## Why

### Problem Statement

Phenotypers are operators who perform plant scans. They are required reference data - every scan must be associated with a phenotyper. Currently, there is no UI for managing phenotypers, requiring direct database manipulation.

### User Need

Lab administrators need a simple, reliable way to:

- View all phenotypers in the system
- Add new phenotypers to the database
- Ensure data quality through validation (unique emails, required fields)

### Current Gap

The bloom-desktop application has:

- ✅ Database schema with Phenotyper model (id, name, email)
- ✅ IPC handlers: `db:phenotypers:list`, `db:phenotypers:create`
- ✅ Preload bridge exposes `window.electron.database.phenotypers`
- ✅ Scientists UI as a reference implementation (PR #64)
- ❌ **No UI for phenotypers management**

The CaptureScan page already references phenotypers:

- Metadata form requires phenotyper selection
- Scans are linked to phenotyper_id in the database
- Currently phenotypers must be added via other means

### Business Value

1. **Unblocks scan workflow** - Phenotypers must exist before scans can be created
2. **Improves data quality** - Email validation prevents duplicate/invalid entries
3. **Reuses established patterns** - Follows Scientists UI implementation (code reuse, maintainability)
4. **Maintains pilot compatibility** - Uses same database schema

### Migration Context

This is the second of 5 database management UI features from pilot:

1. ✅ Scientists (PR #64) - Complete
2. **Phenotypers** (this proposal) - Identical structure to Scientists
3. Accessions - Similar structure (only name field)
4. Experiments - More complex (relational fields)
5. Browse Scans + Scan Preview (Issues #45, #46)

## What Changes

### Extends Existing Capability: UI Management Pages

Add Phenotypers management page following the established Scientists UI patterns.

**Spec delta**: `openspec/changes/add-phenotypers-management-ui/specs/ui-management-pages/spec.md`

### User-Facing Changes

**New route**: `/phenotypers`

**New page**: Phenotypers management with two sections:

1. **List view** - Displays all phenotypers (name, email)
2. **Create form** - Adds new phenotyper with validation

**No edit/delete** - Phenotypers are reference data linked to scans; update/delete would break data integrity.

### Technical Changes

**No new dependencies** - Reuses existing libraries from Scientists UI:

- `zod@^3.22.4` - Schema validation (already installed)
- `@hookform/resolvers@^3.3.4` - Zod + React Hook Form (already installed)
- `react-hook-form@^7.51.0` - Form library (already installed)

**New files**:

- `src/renderer/Phenotypers.tsx` - Main page component (~85 lines)
- `src/renderer/components/PhenotyperForm.tsx` - Form component with validation (~115 lines)
- `tests/unit/components/PhenotyperForm.test.tsx` - Unit tests (~150 lines)
- `tests/e2e/phenotypers-management.e2e.ts` - E2E tests (~400 lines)
- `tests/fixtures/phenotypers.ts` - Test fixtures (~80 lines)

**Modified files**:

- `src/renderer/App.tsx` - Add `/phenotypers` route
- `src/renderer/Layout.tsx` - Add "Phenotypers" navigation link

### Code Quality: TDD Approach

This implementation follows Test-Driven Development:

1. **Write E2E tests first** - Define expected behavior before implementation
2. **Write unit tests** - Test form validation and component behavior
3. **Implement components** - Make tests pass
4. **Refactor** - Extract shared utilities if beneficial

**Test coverage targets**:

- E2E: Full user workflow coverage (navigation, create, validation, edge cases)
- Unit: 100% coverage of PhenotyperForm validation logic

### Code Reuse Strategy

**Extract shared patterns** from Scientists UI:

| Pattern                | Scientists                  | Phenotypers          | Shared Opportunity         |
| ---------------------- | --------------------------- | -------------------- | -------------------------- |
| Form validation schema | `scientistSchema`           | `phenotyperSchema`   | Schema structure identical |
| Error display          | Inline red text             | Inline red text      | Same component             |
| List display           | `ul > li` with name (email) | Same format          | Pattern, not component     |
| Loading state          | Spinner + text              | Same                 | Pattern                    |
| Empty state            | "No scientists yet"         | "No phenotypers yet" | Pattern                    |

**Decision**: Keep separate components for clarity, follow same patterns. Extract shared utilities only if a third management page is added.

### Database Adherence

**Schema compatibility**: ✅ 100% compatible with pilot

```typescript
// prisma/schema.prisma (no changes)
model Phenotyper {
  id    String @id @default(uuid())
  name  String
  email String @unique  // Enforced at DB level
  scans Scan[]
}
```

**IPC handlers**: ✅ Use existing handlers (no changes)

- `db:phenotypers:list` - Fetch all phenotypers
- `db:phenotypers:create` - Create new phenotyper

**Validation alignment**:

- **Required fields**: Zod enforces `name` and `email` (matches schema)
- **Email uniqueness**: Database constraint catches duplicates, UI shows error
- **Email format**: Zod validates format before attempting DB insert
- **UUID generation**: Handled by Prisma `@default(uuid())` (no UI input)

## Impact

### On Existing Features

**Minimal impact** - New UI is additive:

- ✅ No changes to existing routes or components
- ✅ No changes to database schema or IPC handlers
- ✅ No changes to Python backend
- ✅ New route doesn't interfere with existing workflows

### On CaptureScan

**Future integration opportunity**:

The CaptureScan page's MetadataForm currently uses a text input for phenotyper. In a future PR, this could be converted to a dropdown populated from the phenotypers list.

### On Testing

**Increases test coverage**:

- **E2E tests**: Adds ~15 Phenotypers management scenarios
- **Unit tests**: New component tests for PhenotyperForm
- **Test fixtures**: Reusable test data factories

**New test files**:

- `tests/e2e/phenotypers-management.e2e.ts` - Full UI workflow tests
- `tests/unit/components/PhenotyperForm.test.tsx` - Form validation tests
- `tests/fixtures/phenotypers.ts` - Test data factory

### On Development Workflow

**Validates established patterns**:

- Confirms Scientists UI patterns are reusable
- TDD approach ensures quality
- Sets precedent for remaining management pages

## Related

### Issues

- Supports CaptureScan workflow (phenotypers required for scans)
- Continues pilot migration strategy
- Enables future dropdown integration in CaptureScan

### Dependencies

- **Requires**: PR #64 (Scientists Management UI) - ✅ Merged
- **Enables**: Cleaner CaptureScan workflow, Experiments management

### Pilot Reference

- Source: `/repos/bloom-desktop-pilot/app/src/renderer/Phenotypers.tsx`
- Improvements: Same as Scientists (Zod validation, React Hook Form, proper error handling)
- Maintains database schema compatibility
