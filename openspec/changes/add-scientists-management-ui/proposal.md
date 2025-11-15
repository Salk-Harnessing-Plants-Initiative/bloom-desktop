# Add Scientists Management UI

## Why

### Problem Statement

Scientists are foundational reference data in the plant phenotyping workflow - they must exist before experiments can be created. Currently, there is no UI for managing scientists, requiring direct database manipulation or importing data from external sources.

### User Need

Phenotypers and lab administrators need a simple, reliable way to:
- View all scientists in the system
- Add new scientists to the database
- Ensure data quality through validation (unique emails, required fields)

### Current Gap

The bloom-desktop application has:
- ✅ Database schema with Scientist model (id, name, email)
- ✅ IPC handlers tested (93.3% coverage): `db:scientists:list`, `db:scientists:create`
- ✅ E2E testing infrastructure (31 tests passing)
- ❌ **No UI for scientists management**

The bloom-desktop-pilot has a basic Scientists page, but it:
- Lacks input validation (only checks for empty fields)
- Polls database every 10 seconds (inefficient)
- Has minimal error handling
- Provides limited user feedback

### Business Value

1. **Unblocks experiment creation workflow** - Scientists must exist before experiments
2. **Improves data quality** - Email validation prevents duplicate/invalid entries
3. **Establishes UI patterns** - Scientists page sets patterns for Phenotypers, Accessions, and Experiments pages
4. **Provides immediate utility** - First user-facing database management feature
5. **Maintains pilot compatibility** - Uses same database schema and IPC handlers

### Migration Context

This is the first of 5 database management UI features to be migrated from pilot:
1. **Scientists** (this proposal) - Simplest, no dependencies
2. Phenotypers - Identical to Scientists
3. Accessions - Similar to Scientists (only name field)
4. Experiments - More complex (relational fields)
5. Browse Scans + Scan Preview (Issues #45, #46)

## What Changes

### New Capability: UI Management Pages

Add Scientists management page as the first database management UI feature, establishing patterns for future management pages (Phenotypers, Accessions, Experiments).

**Spec**: `openspec/changes/add-scientists-management-ui/specs/ui-management-pages/spec.md`

### User-Facing Changes

**New route**: `/scientists`

**New page**: Scientists management with two sections:
1. **List view** - Displays all scientists (name, email)
2. **Create form** - Adds new scientist with validation

**No edit/delete** - Scientists are reference data; update/delete IPC handlers intentionally not implemented to maintain data integrity.

### Technical Changes

**New dependencies**:
- `zod@^3.22.4` - TypeScript-first schema validation library (already in pilot)
- `@hookform/resolvers@^3.3.4` - Connects Zod with React Hook Form
- `react-hook-form@^7.51.0` - Performant form library with built-in validation

**Rationale for dependencies**:
- **Zod**: TypeScript-native validation with excellent type inference, same library pilot uses
- **React Hook Form**: Minimal re-renders, uncontrolled components for performance, industry standard
- **No new UI library**: Uses existing Tailwind CSS for consistency

**New files**:
- `src/renderer/Scientists.tsx` - Main page component (~120 lines)
- `src/renderer/components/ScientistForm.tsx` - Form component with validation (~100 lines)
- `tests/e2e/scientists-management.e2e.ts` - E2E tests (~150 lines)
- `tests/unit/components/ScientistForm.test.tsx` - Unit tests (~100 lines)

**Modified files**:
- `src/renderer/App.tsx` - Add `/scientists` route
- `src/renderer/Layout.tsx` - Add "Scientists" navigation link
- `package.json` - Add new dependencies

### Code Quality Improvements Over Pilot

| Aspect | Pilot Implementation | This Proposal |
|--------|---------------------|---------------|
| **Validation** | Simple empty check | Zod schema with email format, uniqueness |
| **Error Handling** | console.error only | User-facing error messages |
| **Data Refresh** | Poll every 10 seconds | Refresh on-demand after mutations |
| **Form Library** | Plain useState | React Hook Form (performance) |
| **Loading States** | None | Loading indicators for async operations |
| **Type Safety** | Basic TypeScript | Zod schemas inferred to TypeScript types |
| **User Feedback** | None | Success/error notifications |
| **Accessibility** | Minimal | Proper labels, ARIA attributes |

### What is Zod Validation?

**Zod** (https://zod.dev) is a TypeScript-first schema declaration and validation library that:

1. **Defines schemas** - Declare expected data shape with type inference:
   ```typescript
   const ScientistSchema = z.object({
     name: z.string().min(1, 'Name is required'),
     email: z.string().email('Invalid email format')
   });
   ```

2. **Validates at runtime** - Checks data conforms to schema:
   ```typescript
   const result = ScientistSchema.safeParse(formData);
   if (!result.success) {
     console.error(result.error.issues); // Detailed error messages
   }
   ```

3. **Infers TypeScript types** - No duplicate type definitions:
   ```typescript
   type Scientist = z.infer<typeof ScientistSchema>;
   // { name: string; email: string }
   ```

4. **Provides error messages** - Built-in and customizable validation messages

**Why Zod over alternatives?**
- ✅ TypeScript-native (better DX than Yup, Joi)
- ✅ Zero dependencies (smaller bundle than Joi)
- ✅ Already in pilot's dependencies
- ✅ Works seamlessly with React Hook Form via `@hookform/resolvers`
- ✅ Excellent type inference (no manual type sync)

**Example Scientists form validation**:
```typescript
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

const scientistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Must be a valid email address')
});

type ScientistFormData = z.infer<typeof scientistSchema>;

export function ScientistForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<ScientistFormData>({
    resolver: zodResolver(scientistSchema)
  });

  const onSubmit = async (data: ScientistFormData) => {
    const result = await window.electron.database.scientists.create(data);
    // Handle result...
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}

      <input type="email" {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}

      <button type="submit">Save</button>
    </form>
  );
}
```

### Database Adherence

**Schema compatibility**: ✅ 100% compatible with pilot and current schema
```typescript
// prisma/schema.prisma (no changes)
model Scientist {
  id          String       @id @default(uuid())
  name        String
  email       String       @unique  // Enforced at DB level
  experiments Experiment[]
}
```

**IPC handlers**: ✅ Use existing tested handlers (no changes)
- `db:scientists:list` - Fetch all scientists
- `db:scientists:create` - Create new scientist

**Validation alignment**:
- **Required fields**: Zod enforces `name` and `email` (matches schema)
- **Email uniqueness**: Database constraint catches duplicates, UI shows error
- **Email format**: Zod validates format before attempting DB insert
- **UUID generation**: Handled by Prisma `@default(uuid())` (no UI input)

**Permissions respected**:
- ✅ List and Create only (matches available IPC handlers)
- ❌ No Edit/Delete UI (handlers intentionally not implemented)
- Scientists are reference data - designed to be immutable after creation

## Impact

### On Existing Features

**Minimal impact** - New UI is additive:
- ✅ No changes to existing routes or components
- ✅ No changes to database schema or IPC handlers
- ✅ No changes to Python backend
- ✅ New route doesn't interfere with existing workflows

### On Future Features

**Establishes patterns** for:
1. **Phenotypers page** - Identical structure (name, email)
2. **Accessions page** - Similar structure (name only)
3. **Experiments page** - Will extend pattern with relational fields
4. **Form validation** - Zod schemas become standard
5. **Error handling** - User-facing error patterns
6. **List + Create UI** - Reusable layout pattern

### On Testing

**Increases test coverage**:
- **E2E tests**: 31 → 36 tests (adds 5 Scientists management scenarios)
- **Unit tests**: New component tests for ScientistForm
- **Coverage target**: Maintains 50%+ TypeScript coverage

**New test files**:
- `tests/e2e/scientists-management.e2e.ts` - Full CRUD scenarios
- `tests/unit/components/ScientistForm.test.tsx` - Form validation tests

### On Bundle Size

**New dependencies** (~50KB gzipped):
- `zod@3.22.4` - ~13KB gzipped
- `react-hook-form@7.51.0` - ~25KB gzipped
- `@hookform/resolvers@3.3.4` - ~2KB gzipped

**Total**: ~40KB added (acceptable for production-quality forms)

### On Development Workflow

**Establishes conventions**:
- Form validation pattern (Zod + React Hook Form)
- Component structure for management pages
- E2E testing patterns for UI features
- Error handling and user feedback patterns

**Future developers** can:
- Copy Scientists page as template for Phenotypers/Accessions
- Reuse validation patterns
- Follow established routing conventions

## Related

### Issues
- Enables future Experiments management (requires Scientists)
- Addresses part of pilot migration strategy
- First step toward Issues #45, #46 (Browse Scans, Scan Preview)

### Dependencies
- **Requires**: PR #63 (renderer database IPC testing) - ✅ Merged
- **Requires**: E2E testing infrastructure - ✅ Complete
- **Enables**: Phenotypers, Accessions, Experiments management pages

### Pilot Reference
- Source: `/repos/bloom-desktop-pilot/app/src/renderer/Scientists.tsx`
- Improvements documented in "Code Quality Improvements Over Pilot" section above
- Maintains database schema compatibility
