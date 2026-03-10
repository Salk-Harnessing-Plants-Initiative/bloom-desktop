## Why

GitHub Copilot review on PR #119 identified three robustness issues:

1. Whitespace-only experiment names (e.g. `"   "`) pass Zod validation but submit as empty string after `.trim()` in `onSubmit`. The trim should happen at the schema level so validation catches it.
2. Unit test `beforeEach` mock setup doesn't guard `win.electron.database` existence, which could fail if test setup changes.
3. Unit test `getFormElements()` helper uses bare `as` casts without null checks, making failures harder to diagnose.

## What Changes

- Add `.trim()` to Zod schema for experiment name so whitespace-only names fail validation
- Add `win.electron.database` guard in test `beforeEach`
- Add null-check assertions in `getFormElements()` helper before casting

## Impact

- Affected specs: `ui-management-pages` (Create Experiment — name validation)
- Affected code: `src/renderer/components/ExperimentForm.tsx`, `tests/unit/components/ExperimentForm.test.tsx`
- No database changes
