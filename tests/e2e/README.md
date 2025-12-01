# E2E Tests

End-to-end tests for Bloom Desktop using Playwright.

## Quick Start

> ⚠️ **CRITICAL**: Dev server must be running on http://localhost:9000 before running tests!

**Terminal 1** (keep running):

```bash
npm run start
```

**Terminal 2**:

```bash
npm run test:e2e
```

## What These Tests Do

- ✅ Launch Electron app
- ✅ Verify window creation and visibility
- ✅ Test database initialization (`tests/e2e/test.db`)
- ✅ Check UI rendering and page content
- ✅ Validate document title setting

## Test Files

- **`app-launch.e2e.ts`** - Main E2E test suite
  - Test 1: Application launch and window visibility
  - Test 2: Database initialization on startup
  - Test 3: Page content rendering

## Important Notes

### ⚠️ Dev Server Requirement

**The tests DO NOT start their own dev server!**

Tests launch Electron directly, which loads the renderer from `http://localhost:9000`. Without the dev server running, the Electron window opens but the UI is completely blank.

**Why:** Electron Forge configures `MAIN_WINDOW_WEBPACK_ENTRY` to point to the dev server URL (`http://localhost:9000`), not a file path. This is baked into the webpack build at compile time.

### Database Isolation

Tests use a separate database:

- **Test database**: `tests/e2e/test.db`
- **Dev database**: `prisma/dev.db`

Each test creates a fresh database in `beforeEach` and cleans it up in `afterEach`.

### Platform Differences

- **Linux**: Requires Xvfb (X Virtual FrameBuffer) in CI
- **Linux**: Requires `--no-sandbox` flag (added automatically when `CI=true`)
- **macOS**: Works out of the box
- **Windows**: Works out of the box

## Running Tests

```bash
# Standard run (headless)
npm run test:e2e

# UI mode (recommended for debugging)
npm run test:e2e:ui

# Debug mode (with debugger)
npm run test:e2e:debug
```

## Configuration

- **`playwright.config.ts`** - Playwright test configuration
- **`.env.e2e`** - E2E environment variables (database URL, etc.)
- **`app-launch.e2e.ts`** - Test implementation with detailed inline comments

## Troubleshooting

### Blank Electron Window

**Problem**: Window opens but no content appears

**Solution**: Start dev server first!

```bash
# Terminal 1
npm run start

# Wait for: "✔ Launched Electron app"

# Terminal 2
npm run test:e2e
```

### Port Already in Use

**Problem**: Dev server fails to start (port 9000 in use)

**Solution**: Kill the process using port 9000

```bash
# macOS/Linux
lsof -ti :9000 | xargs kill -9

# Windows
netstat -ano | findstr :9000
taskkill /F /PID <PID>
```

### Tests Timeout

**Problem**: `TimeoutError: page.waitForFunction: Timeout 60000ms exceeded`

**Likely Cause**: Dev server not running or very slow machine

**Solution**: Verify dev server is running and accessible:

```bash
curl http://localhost:9000
# Should return HTML content
```

## Playwright Best Practices

### Navigation Assertions

**DO:** Use semantic role-based selectors
```typescript
await expect(
  window.getByRole('heading', { name: 'PageName', exact: true })
).toBeVisible();
```

**DON'T:** Use CSS selectors with text content
```typescript
await expect(window.locator('h1:has-text("PageName")')).toBeVisible();
```

**Why:** Role-based selectors are more reliable and align with accessibility best practices. They're less likely to break with UI changes and better represent how users interact with the page.

### Checking Multiple Elements

**DO:** Check each element individually
```typescript
await expect(window.locator('button:has-text("Edit")')).toBeVisible();
await expect(window.locator('button:has-text("Delete")')).toBeVisible();
```

**DON'T:** Use comma-separated selectors with single assertion
```typescript
await expect(
  window.locator('button:has-text("Edit"), button:has-text("Delete")')
).toBeVisible();
```

**Why:** Comma selectors match ALL elements (both Edit and Delete), causing Playwright strict mode violations. Strict mode requires exactly one element match.

### React Controlled Inputs

**DO:** Use `getByRole()` and verify value with `toHaveValue()`
```typescript
const input = window.getByRole('textbox').first();
await expect(input).toHaveValue('expected value');
```

**DON'T:** Use attribute selectors like `input[value="..."]`
```typescript
const input = window.locator('input[value="Old Name"]');
```

**Why:** React controlled inputs set the `value` property (JavaScript), not the `value` attribute (HTML). Attribute selectors check the HTML attribute, which React doesn't update for controlled components.

### Multiple Textboxes on Page

**DO:** Use `.first()` or `.last()` to disambiguate when multiple textboxes exist
```typescript
// Gets the first textbox (e.g., edit input in expanded section)
const editInput = window.getByRole('textbox').first();
```

**DON'T:** Use `getByRole('textbox')` when multiple exist
```typescript
const editInput = window.getByRole('textbox'); // Throws strict mode error
```

**Why:** Playwright strict mode requires exactly one element match. When multiple textboxes exist (e.g., edit input + create form input), you must specify which one using `.first()`, `.last()`, or more specific selectors.

**Important:** Always verify DOM order before using `.first()` or `.last()`. The order might not match your assumptions!

### Dialog Handling

For native browser dialogs (`confirm()`, `alert()`, `prompt()`), you need to handle them differently than UI buttons:

```typescript
// Listen for dialog before triggering the action
electronApp.on('dialog', async (dialog) => {
  await dialog.accept(); // or dialog.dismiss()
});

// Then trigger the action that shows the dialog
await window.click('button:has-text("Delete")');
```

**Note:** If your component uses `window.confirm()` instead of a custom UI dialog, tests expecting UI buttons will fail.

## Full Documentation

For complete documentation including architecture, CI/CD integration, common pitfalls, and debugging guides, see:

👉 **[/docs/E2E_TESTING.md](../../docs/E2E_TESTING.md)**

Includes:

- Architecture explanation (why dev server is required)
- CI/CD integration details
- Platform-specific requirements (Xvfb, sandbox, timing)
- Common pitfalls and solutions
- Debugging strategies
- Troubleshooting guide
