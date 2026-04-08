## 1. Add E2E Layout Test (RED)

- [ ] 1.1 Add Playwright E2E test that verifies Camera Settings page has a centered `max-w-7xl` container:
  - Test: Camera Settings page root content container has `max-w-7xl` and `mx-auto` classes
  - Test: Camera Settings page has `bg-gray-50` background
  - Test: Two-column grid layout is present with settings form and live preview
- [ ] 1.2 Run E2E test — verify RED (container classes not yet present)

## 2. Update Camera Settings Layout (GREEN)

- [ ] 2.1 Update `src/renderer/CameraSettings.tsx` root container:
  - Change outer div from `className="p-8"` to `className="min-h-screen bg-gray-50 p-6"`
  - Wrap content in `<div className="max-w-7xl mx-auto space-y-6">`
  - Update panel shadows from `shadow` to `shadow-sm`
- [ ] 2.2 Run E2E test — verify GREEN
- [ ] 2.3 Run full test suite: `npx vitest run` + `npm run test:e2e`
- [ ] 2.4 Visual verification: open Camera Settings and CaptureScan side-by-side, confirm layout alignment

## 3. Commit

- [ ] 3.1 Commit: `fix: center Camera Settings page layout to match CaptureScan`
