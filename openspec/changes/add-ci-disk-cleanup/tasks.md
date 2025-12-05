## 1. Implementation

- [x] 1.1 Add `jlumbroso/free-disk-space@main` action to `test-e2e-dev` job (Linux only, after checkout)
- [x] 1.2 Add `jlumbroso/free-disk-space@main` action to `test-dev-database` job (after checkout)
- [x] 1.3 Configure action with `tool-cache: false` to preserve Node.js/Python caches

## 2. Verification

- [ ] 2.1 Commit and push changes to trigger CI workflow
- [ ] 2.2 Verify all CI tests pass without ENOSPC errors
- [ ] 2.3 Verify no existing tests are affected by cleanup changes