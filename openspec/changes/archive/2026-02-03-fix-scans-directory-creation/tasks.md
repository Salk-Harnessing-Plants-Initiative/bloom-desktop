# Tasks: Fix Scans Directory Creation UX

## Implementation Checklist (TDD Approach)

### Phase 1: Write Tests First (TDD)

- [x] 1.1 Add test: saveConfig auto-creates non-existent scans directory
- [x] 1.2 Add test: saveConfig auto-creates nested parent directories
- [x] 1.3 Add test: saveConfig succeeds with existing writable directory
- [x] 1.4 Add test: Validation checks parent directory writability
- [x] 1.5 Add test: Validation fails with clear error for non-writable parent
- [x] 1.6 Run tests: `npm run test:unit` - expect 5 failures ❌

### Phase 2: Update Validation Logic (TDD)

- [x] 2.1 Update `validateConfig()` in src/main/config-store.ts
- [x] 2.2 For existing directories: check writability (unchanged)
- [x] 2.3 For non-existent directories: check parent exists and is writable
- [x] 2.4 Provide clear error messages with parent path
- [x] 2.5 Run validation tests - expect validation tests to pass ✅

### Phase 3: Add Directory Auto-creation (TDD)

- [x] 3.1 Update `saveConfig()` in src/main/config-store.ts
- [x] 3.2 After validation, before writing .env file
- [x] 3.3 Check if scans_dir exists with `fs.existsSync()`
- [x] 3.4 If not exists, create with `fs.mkdirSync(scans_dir, { recursive: true })`
- [x] 3.5 Add console logging for directory creation
- [x] 3.6 Wrap in try-catch, throw descriptive error on failure
- [x] 3.7 Run saveConfig tests - expect auto-creation tests to pass ✅

### Phase 4: Integration with Existing Tests

- [x] 4.1 Update existing config-store tests that create temp directories
- [x] 4.2 Verify tests still clean up properly
- [x] 4.3 Run full test suite: `npm run test:unit` - expect all tests to pass ✅
- [x] 4.4 Run TypeScript compiler: `npx tsc --noEmit` - expect no errors ✅

### Phase 5: Manual Testing

- [x] 5.1 Test: Delete ~/.bloom/ directory
- [x] 5.2 Test: Start app in development mode
- [x] 5.3 Test: Configure scans directory to ~/.bloom/dev-scans
- [x] 5.4 Test: Save configuration (should succeed)
- [x] 5.5 Test: Verify ~/.bloom/dev-scans directory was created
- [x] 5.6 Test: Configure scans directory to /root/scans
- [x] 5.7 Test: Verify validation error with clear parent path message
- [x] 5.8 Test: Create external directory /tmp/test-scans
- [x] 5.9 Test: Configure scans directory and verify save succeeds

### Phase 6: Code Quality and Cleanup

- [x] 6.1 Add code comments explaining auto-creation logic
- [x] 6.2 Run linter: `npm run lint` - fix any errors
- [x] 6.3 Run formatter: `npm run format`
- [x] 6.4 Verify console logging is appropriate (info, not error)

### Phase 7: Validate Spec

- [x] 7.1 Run: `npx openspec validate fix-scans-directory-creation --strict`
- [x] 7.2 Fix any validation errors
- [x] 7.3 Confirm all scenarios covered by tests

---

## Implementation Notes

This proposal has been fully implemented:

1. **Auto-creation in saveConfig()**: Lines 153-165 in config-store.ts
2. **Console logging**: "[Config] Creating scans directory:" and "[Config] Scans directory created successfully"
3. **Recursive creation**: Uses `fs.mkdirSync(config.scans_dir, { recursive: true })`
4. **Error handling**: Wraps in try-catch with descriptive error message

Verified by test output showing:

```
[Config] Creating scans directory: /var/folders/.../new-scans
[Config] Scans directory created successfully
```

Test suite: 55 config-store tests passing including:

- "should auto-create non-existent scans directory on save"
- "should auto-create nested scans directories recursively"
