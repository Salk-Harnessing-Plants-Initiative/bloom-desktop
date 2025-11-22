# Example Prompts for Claude CLI

These are concrete example prompts tailored for Claude CLI usage with this Electron + React + Playwright project.

---

## 1. Refactoring a Shared React Component

**Use case**: Component needs to be reused in multiple places

```
I need to refactor the ScientistForm component in src/renderer/components/ScientistForm.tsx.

Current issues:
- It's tightly coupled to the Scientists page
- I want to reuse it for a "quick add scientist" modal in CaptureScan.tsx

Please:
1. First, read src/renderer/components/ScientistForm.tsx
2. Read src/renderer/Scientists.tsx to see current usage
3. Create a refactoring plan that:
   - Extracts the form logic into a reusable component
   - Accepts an onSubmit callback prop
   - Maintains all existing validation
   - Keeps TypeScript types intact
4. After I approve the plan, implement the changes
5. Update the existing Scientists.tsx to use the new API
6. Run npm run lint && npm run test:unit

Do NOT modify any E2E tests or database handlers.
```

**Why this works**:
- Forces reading before editing
- Defines scope explicitly ("do NOT modify...")
- Requires a plan before implementation
- Specifies validation command

---

## 2. Updating Preload Scripts and IPC Handlers

**Use case**: Adding new IPC functionality

```
I need to add a new IPC handler for bulk-deleting scientists.

Requirements:
- Handler name: db:scientists:deleteMany
- Input: array of scientist IDs
- Output: count of deleted scientists
- Must validate input with Zod

Files that need changes:
1. src/main/database-handlers.ts - add the handler
2. src/main/preload.ts - expose via contextBridge
3. src/types/electron.d.ts - update type definitions

Please follow the existing pattern used by other handlers in database-handlers.ts.
After implementation, run npm run lint.

Do NOT:
- Modify the Prisma schema
- Add any UI for this feature yet
- Create tests (I'll do that separately)
```

**Why this works**:
- Lists exact files to modify
- References existing patterns
- Explicit about what NOT to do
- Separates concerns (no UI, no tests)

---

## 3. Adding a New Feature (Full Stack)

**Use case**: Feature touching main, preload, renderer, and tests

```
I'm implementing a new feature: Scientists can have an optional "institution" field.

Please implement in this order:
1. Prisma schema migration (prisma/schema.prisma)
2. Generate Prisma client (npx prisma generate)
3. Database handlers (src/main/database-handlers.ts)
4. Preload bridge (src/main/preload.ts)
5. Type definitions (src/types/electron.d.ts)
6. ScientistForm component (add input field)
7. Scientists page (display institution in list)

For each step:
- Show me what you're changing
- Run relevant tests after
- Don't proceed to next step until current one passes lint

Validation rules for institution:
- Optional field
- Max 255 characters
- No special validation otherwise

After all steps, run full test suite: npm run lint && npm run test:unit
```

**Why this works**:
- Explicit ordering (prevents skipping steps)
- Incremental validation
- Clear requirements for the field

---

## 4. Debugging a Flaky Playwright Test

**Use case**: Test passes locally, fails in CI

```
The E2E test "should display created scientists in alphabetical order" in
tests/e2e/scientists-management.e2e.ts is flaky in CI.

It passes locally but fails ~30% of the time in GitHub Actions (Linux).

Please:
1. Read the test file (especially that specific test)
2. Identify potential race conditions or timing issues
3. Look for:
   - Fixed waitForTimeout calls
   - Missing wait conditions
   - Assumptions about rendering order
4. Propose fixes with explanations
5. Implement fixes
6. Do NOT add arbitrary longer timeouts - use proper Playwright waiting

After changes, explain how to verify the fix:
- What to look for in CI logs
- How many CI runs would indicate stability
```

**Why this works**:
- Gives specific context (CI vs local)
- Lists what to look for
- Prohibits band-aid fixes (longer timeouts)
- Asks for verification strategy

---

## 5. Adding E2E Test Coverage

**Use case**: New test for existing feature

```
Add an E2E test for the "edit scientist" workflow in tests/e2e/scientists-management.e2e.ts.

The workflow to test:
1. Navigate to Scientists page
2. Create a scientist (reuse existing pattern)
3. Click "Edit" button on that scientist
4. Modify the name field
5. Save changes
6. Verify the updated name appears in the list

Please:
1. Read the existing test file first
2. Follow the same beforeEach/afterEach pattern
3. Use proper Playwright waiting (no fixed timeouts)
4. Add descriptive test name

After adding the test:
1. Run npm run test:e2e to verify it passes
2. Show me the test code
```

**Why this works**:
- Clear workflow steps
- References existing patterns
- Enforces best practices

---

## 6. Moving Logic from Renderer to Main

**Use case**: Refactoring for better architecture

```
I need to move the file path validation logic from renderer to main process.

Current state:
- Logic is in src/renderer/utils/pathValidator.ts
- It uses Node.js 'path' module (BAD - shouldn't be in renderer!)

Desired state:
- Logic lives in src/main/utils/pathValidator.ts
- Exposed via IPC through preload bridge
- Renderer calls it via window.electron.utils.validatePath()

Please:
1. Create a detailed plan (don't write code yet)
2. Identify type changes needed
3. List tests that need updating
4. Show me the plan for approval

After approval:
- Implement in order: main → preload → types → renderer
- Run npm run lint && npm run test:unit after each step
```

**Why this works**:
- Explains the architectural issue
- Requires plan first
- Explicit implementation order
- Incremental validation

---

## 7. Investigating CI Failure

**Use case**: Test fails in CI but not locally

```
The CI is failing on the "should initialize database on startup" test.

Error from CI:
```
expect(dbExists).toBe(true)
Expected: true
Received: false
```

Please:
1. Read tests/e2e/app-launch.e2e.ts (that test specifically)
2. Read the CI workflow (.github/workflows/pr-checks.yml)
3. Check the database initialization in src/main/database.ts
4. Identify possible causes:
   - Timing issues
   - Path resolution differences
   - Environment variable issues
5. Propose a fix

Do NOT:
- Add arbitrary delays
- Skip the test
- Change unrelated code
```

**Why this works**:
- Provides specific error
- Lists files to investigate
- Suggests areas to check
- Prohibits bad solutions

---

## 8. Writing Unit Tests for New Component

**Use case**: Adding test coverage

```
Write unit tests for the new MetadataForm component at src/renderer/components/MetadataForm.tsx.

Test these scenarios:
1. Renders with default values
2. Shows validation errors for required fields
3. Calls onSubmit with correct data
4. Disables submit button when form is invalid

Please:
1. Read the component first
2. Follow patterns in tests/unit/ScientistForm.test.tsx
3. Use @testing-library/react
4. Mock window.electron if needed

After writing tests, run: npm run test:unit:coverage
Show me the coverage for this file.
```

**Why this works**:
- Specific test scenarios
- References existing patterns
- Specifies testing library
- Asks for coverage verification

---

## 9. Fixing Type Errors After Upgrade

**Use case**: TypeScript upgrade or dependency update

```
After upgrading TypeScript, there are type errors in src/main/database-handlers.ts.

Run npx tsc --noEmit and show me the errors.

For each error:
1. Explain why it's happening
2. Propose a fix that maintains type safety
3. Implement the fix

Do NOT:
- Use `any` type unless absolutely necessary
- Use @ts-ignore comments
- Weaken existing types

After fixing, run: npm run lint && npx tsc --noEmit
```

**Why this works**:
- Asks for diagnostic first
- Requires explanation
- Prohibits type-unsafe shortcuts

---

## 10. Adding Playwright MCP Integration

**Use case**: Using Playwright MCP for exploratory testing

```
I want to use Playwright MCP to explore the Scientists page behavior.

Please:
1. Navigate to http://localhost:9000 (dev server must be running)
2. Click on "Scientists" in the navigation
3. Take a screenshot of the empty state
4. Fill in the form with test data
5. Submit the form
6. Take a screenshot of the result
7. Describe what you observed

After exploration, suggest any E2E tests that should be added based on what you found.
```

**Why this works**:
- Clear exploration steps
- Asks for screenshots
- Connects exploration to permanent tests

---

## Prompt Structure Guidelines

### Context Section
- Current state of the code
- What's working/not working
- Any relevant error messages

### Requirements Section
- What needs to change
- Constraints and boundaries
- Files involved

### Process Section
- Order of operations
- Validation steps
- What to do after each step

### Boundaries Section
- What NOT to modify
- What NOT to use (e.g., `any` types, fixed timeouts)
- Scope limits

### Verification Section
- Commands to run
- What success looks like
- How to confirm the fix works