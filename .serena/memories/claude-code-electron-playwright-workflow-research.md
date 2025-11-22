# Claude Code + Electron + Playwright Workflow Research

Research completed 2025-11-21 for developing a Claude skill for bloom-desktop development workflow.

## Key Findings

### 1. Playwright + Electron Best Practices

**Launch Configuration:**

- Use `_electron.launch()` with `executablePath` pointing to Electron
- Pass `.webpack/main/index.js` as entry point (not source files)
- For CI Linux: Add `--no-sandbox` and set `ELECTRON_DISABLE_SANDBOX=1`
- Default timeout: 30s, can be increased for slow CI

**Dev Server Requirement:**

- E2E tests require `npm run start` running (port 9000)
- `MAIN_WINDOW_WEBPACK_ENTRY` points to `http://localhost:9000`
- Without dev server, Electron window is blank

**Flaky Test Prevention:**

- Avoid `waitForTimeout()` - use `expect().toBeVisible()` or `waitForLoadState('networkidle')`
- Use fixtures for consistent setup/teardown
- CI is slower - use proper waiting, not fixed delays

### 2. Claude Code Workflow Patterns

**MCP Integration:**

- Playwright MCP: `claude mcp add playwright -- npx -y @playwright/mcp@latest`
- Enables Claude to navigate, screenshot, and interact with UI
- Create `.claude/commands/qa-<flow>.md` for reusable test workflows

**Professional Workflow Structure:**

```
project/
├── .claude/
│   ├── commands/     # Slash commands (already have these)
│   └── skills/       # Auto-invoked capabilities
├── openspec/         # Spec-driven development (already have this)
└── docs/             # Reference documentation
```

**Best Practices:**

- Use "priming lanes" to load specific context (specs only, tests only)
- Spec-driven development: PRD → Claude generates code → auto-validation
- Keep agent tool counts under 30 for focus
- Git worktrees for A/B testing implementations

### 3. Skill Structure (Planned)

```
.claude/skills/electron-playwright-workflow/
├── SKILL.md          # Main instructions
├── reference.md      # Testing patterns
└── examples.md       # Prompt templates
```

**SKILL.md frontmatter:**

```yaml
---
name: electron-playwright-workflow
description: |
  Development workflow for Electron + React + TypeScript apps with Playwright E2E testing...
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
---
```

### 4. bloom-desktop Specific Patterns

**Architecture:**

- Main process: `src/main/` (Node.js, IPC handlers)
- Renderer: `src/renderer/` (React, browser context)
- Preload: `src/main/preload.ts` (security boundary)
- Python: `python/` (hardware control subprocess)

**Testing Stack:**

- Unit: Vitest + happy-dom (50%+ coverage)
- Python: pytest (80%+ coverage enforced)
- E2E: Playwright with isolated test database
- Integration: IPC, camera, DAQ, scanner tests

**Existing Commands:**

- `/e2e-testing` - Playwright guide
- `/ci-debug` - CI debugging
- `/integration-testing` - Integration tests
- `/lint`, `/coverage`, etc.

### 5. Common E2E Issues

| Issue             | Cause                  | Solution                     |
| ----------------- | ---------------------- | ---------------------------- |
| Blank window      | Dev server not running | Start `npm run start` first  |
| Timeout on launch | Wrong entry point      | Use `.webpack/main/index.js` |
| Linux CI fails    | No display             | Use `xvfb-run`               |
| Sandbox error     | Linux permissions      | `ELECTRON_DISABLE_SANDBOX=1` |
| Flaky tests       | Fixed timeouts         | Use proper Playwright waits  |

### 6. Resources

- Playwright Electron docs: https://playwright.dev/docs/api/class-electron
- electron-playwright-helpers: npm package for multi-window testing
- spaceagetv/electron-playwright-example: GitHub reference implementation
- Playwright MCP: @playwright/mcp@latest

## Next Steps (Paused)

1. Create SKILL.md with workflow instructions
2. Create reference.md with testing patterns
3. Create examples.md with prompt templates
4. Test skill auto-invocation

## Update: ELECTRON_RUN_AS_NODE Issue RESOLVED (Nov 2025)

**Root Cause Discovered**: The `remote-debugging-port` issue was caused by `ELECTRON_RUN_AS_NODE=1` being set in the Claude Code VS Code extension environment. This makes Electron run as plain Node.js, rejecting Chromium flags.

**Solution**: Added to `playwright.config.ts`:

```typescript
delete process.env.ELECTRON_RUN_AS_NODE;
```

**Impact on Workflow**:

- Claude Code can now run E2E tests directly
- No special terminal needed for E2E testing
- All documented workflows now work in Claude Code environment

**Documentation Updates Made**:

- `playwright.config.ts`: Fix with detailed comment
- `docs/E2E_TESTING.md`: Added Pitfall 6
- `tests/e2e/app-launch.e2e.ts`: Updated header comment
- `openspec/changes/archive/.../design.md`: Added Issue 12
- This memory file: Updated

**Next Steps**: Resume Claude skill development for the workflow.
