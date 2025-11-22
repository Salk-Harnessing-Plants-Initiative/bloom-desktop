# Design: Add Scientists Management UI

## Architecture Overview

This change introduces the first database management UI feature to bloom-desktop, establishing patterns that will be reused for Phenotypers, Accessions, and Experiments pages.

### Component Hierarchy

```
App.tsx
└── Layout.tsx
    └── Scientists.tsx (new)
        ├── List Section
        │   ├── Loading state
        │   ├── Empty state
        │   └── Scientists list (name, email)
        └── Create Section
            └── ScientistForm.tsx (new)
                ├── Name input (with validation)
                ├── Email input (with validation)
                ├── Validation error displays
                └── Submit button (with loading state)
```

## Component Design

### Scientists.tsx

**Responsibilities**:

- Fetch scientists list on mount
- Manage list state and loading state
- Render list view with empty state handling
- Integrate ScientistForm for creation
- Refresh list after successful creation

**State Management**:

```typescript
const [scientists, setScientists] = useState<Scientist[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
```

**Data Flow**:

1. Component mounts → fetch scientists via `window.electron.database.scientists.list()`
2. User submits form → ScientistForm calls create IPC handler
3. ScientistForm emits success event → Scientists.tsx refreshes list
4. No polling (unlike pilot's 10-second interval)

**Why this approach**:

- On-demand refresh is more efficient than polling
- Parent component controls when to refresh (after mutations)
- Clear separation of concerns (list vs form)

### ScientistForm.tsx

**Responsibilities**:

- Collect user input for name and email
- Validate input using Zod schema
- Submit to IPC handler
- Display validation errors
- Show loading/success/error states
- Reset form after successful submission
- Notify parent on success for list refresh

**Validation Strategy**:

```typescript
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

const scientistSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  email: z.string().email('Must be a valid email address'),
});

type ScientistFormData = z.infer<typeof scientistSchema>;
```

**State Management**:

- React Hook Form manages form state (uncontrolled components)
- Zod schema provides validation rules
- `formState.errors` provides field-level errors
- `formState.isSubmitting` provides loading state

**Error Handling**:

1. **Client-side validation errors** (Zod):
   - Empty name → "Name is required"
   - Invalid email format → "Must be a valid email address"
   - Display inline below input fields
2. **Server-side errors** (IPC/database):
   - Duplicate email (DB unique constraint) → "Email already exists"
   - Network/database errors → Display error message above form
   - Clear errors on retry

**Why React Hook Form + Zod**:

- **Performance**: Uncontrolled components minimize re-renders (vs pilot's useState on every keystroke)
- **Type Safety**: Zod infers TypeScript types automatically
- **DX**: Single source of truth for validation rules
- **User Experience**: Instant client-side feedback before network call
- **Industry Standard**: Well-maintained, widely adopted libraries

## Data Flow

### Create Scientist Flow

```
User fills form
    ↓
React Hook Form validates (Zod schema)
    ↓
Client-side validation passes?
    ├─ No → Display inline errors
    │
    └─ Yes → Submit to IPC
            ↓
        window.electron.database.scientists.create(data)
            ↓
        Database unique constraint check
            ├─ Duplicate email → Return error
            │       ↓
            │   Display error message
            │
            └─ Success → Insert scientist
                    ↓
                Show success feedback
                    ↓
                Reset form
                    ↓
                Notify parent (refresh list)
```

### List Scientists Flow

```
Component mounts
    ↓
Set loading state
    ↓
window.electron.database.scientists.list()
    ↓
Receive scientists array
    ↓
Update state, clear loading
    ↓
Render list view
    ├─ Empty array → Show "No scientists yet"
    └─ Has scientists → Show list items
```

## Styling Approach

**Design System**: Tailwind CSS (already in project)

**Color Palette** (matching pilot):

- Background: white/gray-50
- Text: gray-700
- Borders: gray-300
- Buttons: gray-200 hover:gray-50
- Errors: red-600
- Success: green-600

**Layout**:

```
┌─────────────────────────────────────┐
│ Scientists                          │  ← Page title
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ Name (email)                    │ │  ← List view
│ │ Name (email)                    │ │  (scrollable)
│ │ ...                             │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Name                                │  ← Create form
│ [input field]                       │
│                                     │
│ Email                               │
│ [input field]                       │
│                                     │
│ [Add new scientist button]          │
└─────────────────────────────────────┘
```

**Responsive Design**: Fixed width containers (w-96 for list), left-aligned layout

**Accessibility**:

- Proper `<label>` elements for inputs
- ARIA attributes for error messages
- Focus states for keyboard navigation
- Semantic HTML (form, button, ul/li)

## IPC Integration

**Handlers Used** (existing, tested):

- `db:scientists:list` → Fetch all scientists
- `db:scientists:create` → Create new scientist

**Type Safety**:

```typescript
// Shared types from preload.ts
interface Scientist {
  id: string;
  name: string;
  email: string;
}

interface DatabaseResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

**Error Response Handling**:

```typescript
const result = await window.electron.database.scientists.create(data);
if (!result.success) {
  // Display result.error to user
  setError(result.error || 'Failed to create scientist');
} else {
  // Success flow
  onSuccess();
}
```

## Testing Strategy

### E2E Tests (Playwright)

**File**: `tests/e2e/scientists-management.e2e.ts`

**Test Scenarios**:

1. **List empty state** - Verify "No scientists yet" message
2. **Create valid scientist** - Fill form, submit, verify success
3. **List shows created scientist** - Verify new entry appears
4. **Validation: empty name** - Submit empty, verify error
5. **Validation: invalid email** - Submit bad email, verify error
6. **Duplicate email constraint** - Create duplicate, verify DB error

**Coverage**: All user-facing interactions with Scientists page

### Unit Tests (Jest + React Testing Library)

**File**: `tests/unit/components/ScientistForm.test.tsx`

**Test Scenarios**:

1. **Renders all form fields** - Name input, email input, submit button
2. **Shows validation errors** - Required name, invalid email format
3. **Calls IPC on valid submit** - Mock IPC, verify call with correct data
4. **Resets form on success** - Verify inputs cleared after creation
5. **Shows error on failure** - Mock IPC error, verify error message

**Coverage**: Form validation logic, IPC integration, error handling

### Test Database

**Strategy**: Use existing test database setup from PR #63

- Tests run against isolated SQLite database
- Database reset between test suites
- Both dev mode and packaged mode tested

## Security Considerations

**Input Validation**:

- Client-side: Zod validates format (catches typos early)
- Server-side: Prisma validates against schema
- Database: Unique constraint on email (prevents duplicates)

**SQL Injection**: ✅ Not applicable (Prisma uses parameterized queries)

**XSS Prevention**: ✅ React escapes rendered content by default

**Email Privacy**:

- Emails visible in UI (required for identifying scientists)
- No external transmission (local-only SQLite database)
- No email validation via external service (format check only)

## Performance Considerations

**Form Performance**:

- React Hook Form uses uncontrolled components (fewer re-renders than pilot)
- Validation runs on blur and submit (not on every keystroke)
- Debouncing not needed for small forms (2 fields)

**List Rendering**:

- Simple list (no virtualization needed for <100 items)
- Re-render only on mutation (no polling like pilot)
- Memoization not needed (simple component)

**Bundle Size Impact**:

- zod: ~13KB gzipped
- react-hook-form: ~25KB gzipped
- @hookform/resolvers: ~2KB gzipped
- **Total**: ~40KB (acceptable for production forms)

## Migration from Pilot

### What We're Keeping

✅ **Visual Design**: Tailwind classes, layout structure
✅ **Database Schema**: No changes to Scientist model
✅ **IPC Handlers**: Using existing list and create handlers
✅ **Permission Model**: List + Create only (no edit/delete)

### What We're Improving

❌ **Polling** → ✅ **On-demand refresh**
❌ **Plain useState** → ✅ **React Hook Form**
❌ **Basic empty check** → ✅ **Zod validation**
❌ **console.error only** → ✅ **User-facing error messages**
❌ **No loading states** → ✅ **Loading indicators**
❌ **No type safety** → ✅ **Zod-inferred types**

### Compatibility

**Database**: ✅ 100% compatible (same schema, same IPC handlers)
**Pilot Migration**: ✅ Can run both apps against same database
**Future Features**: ✅ Establishes patterns for Phenotypers, Accessions, Experiments

## Future Extensibility

This design establishes patterns that will be reused for:

1. **Phenotypers page** - Identical structure (name + email)
2. **Accessions page** - Similar structure (name only)
3. **Experiments page** - Extended pattern (relational fields)

**Reusable Patterns**:

- Zod validation schemas
- React Hook Form integration
- List + Create layout
- Error handling strategy
- E2E test structure
- IPC response handling

**Not Reusable** (intentionally):

- No generic CRUD component (each entity has unique requirements)
- No shared form component (fields differ per entity)
- Keep components simple and specific
