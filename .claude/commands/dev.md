# Run Dev Server & Verify in Browser

Start the Electron dev server and verify changes by exercising the running app.

## Commands

```bash
# Start the dev server (builds the Python executable, then launches Electron Forge)
npm run dev

# Production-like build for verifying the full packaging pipeline (see /packaging for detail)
npm run package
```

## Verification (REQUIRED for UI changes)

**Claim UI work complete only after exercising the running app.** Type checking and tests verify code correctness, not feature correctness.

Bloom Desktop is an Electron app (not a browser page), so verification means launching it via `npm run dev` and using Playwright MCP against the Electron window, or `npm run test:e2e` for scripted verification. Use one of:

1. `npm run dev` and manually exercise the golden path in the launched window
2. Playwright MCP driving the Electron app (see `.claude/skills/electron-playwright-workflow`)
3. `npm run test:e2e` for the scripted Playwright E2E suite (see `/e2e-testing`)

Exercise:

1. The golden path for the change
2. Edge cases (empty state, error state, hardware-disconnected state — mock hardware is used by default)
3. Adjacent screens that share components, IPC handlers, or database state

If you cannot launch the app (e.g., no display available), say so explicitly rather than claiming success.

## Common Issues

### Port already in use (dev server / webpack, default 9000)

```bash
# Windows
netstat -ano | findstr :9000

# macOS/Linux
lsof -i :9000
```

### Python executable stale or missing

`npm run dev` runs `build:python` automatically. If IPC calls hang or fail with "process not ready", rebuild explicitly:

```bash
npm run build:python
```

### Database not initialized

```bash
npm run prisma:generate
npm run prisma:migrate
```

### Environment variables missing

Check `.env.example` and ensure required variables are set in `.env` before starting the dev server.

## Related Commands

- `/test` — Verify code correctness before browsing
- `/lint` — Run linting and type checks
- `/e2e-testing` — Scripted Playwright verification
- `/packaging` — Full production packaging walkthrough
- `/pre-merge` — Full sweep including build verification
