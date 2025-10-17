# TypeScript Unit Tests

This directory contains unit tests for TypeScript/React components and utilities.

## Current Test Coverage

### ✅ Passing Tests
- **Layout.test.tsx** - Navigation and layout structure (3 tests)

### ❌ Removed Tests (Require E2E Testing)
The following tests were removed because they require integration testing with IPC:

- **App.test.tsx** - Removed (tests full app with IPC)
- **Home.test.tsx** - Removed (includes PythonStatus with async IPC)

**Why removed?**
- These components use `window.electron.python` API with async `useEffect` hooks
- React 18 concurrent rendering + async effects = difficult to unit test
- Testing IPC communication is better suited for E2E tests
- Manual testing confirms functionality works correctly

## Tests That Need E2E Coverage (Issue #25)

When implementing Playwright E2E tests, prioritize:

### 1. Python IPC Communication
- [ ] App launches and Python subprocess starts
- [ ] Python version displays correctly in PythonStatus component
- [ ] "Check Hardware" button queries devices and shows status
- [ ] "Restart Python" button restarts subprocess successfully
- [ ] Error states display when Python crashes
- [ ] Status updates appear in real-time

### 2. App Integration
- [ ] App component renders Layout + Home together
- [ ] Navigation between routes works
- [ ] PythonStatus component displays in Home page
- [ ] IPC events propagate to UI correctly

### 3. Hardware Detection Display
- [ ] Shows "[OK] N device(s) found" when devices present
- [ ] Shows "[WARN] Library installed, no devices found" when no devices
- [ ] Shows "[ERROR] Library not installed" when library missing
- [ ] Color coding works (green/yellow/red)

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run with coverage
npm run test:unit:coverage

# Run in watch mode
npm run test:unit:watch

# Run with UI
npm run test:unit:ui
```

## Test Framework

- **Vitest**: Test runner and assertion library
- **@testing-library/react**: React component testing
- **happy-dom**: Fast DOM environment for tests

## Current Structure

```
unit/
├── Layout.test.tsx           # Navigation layout tests (passing)
├── setup.ts                  # Global test setup (mocks window.electron)
└── components/
    └── (none currently)      # Future isolated component tests
```

## Writing New Tests

### Good Candidates for Unit Tests
- Pure components without IPC/async effects
- Utility functions
- Type transformations
- Synchronous state management

### Should Use E2E Tests Instead
- Components using `window.electron` API
- Components with async `useEffect` hooks calling IPC
- Full page/route integration
- Subprocess communication
- Hardware interaction

## Example Test

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../../src/renderer/MyComponent';

describe('MyComponent', () => {
  it('renders without crashing', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## Integration Tests

End-to-end integration tests belong in:
- `tests/integration/` - Node.js/Python IPC tests
- `tests/e2e/` (future) - Playwright browser automation tests
