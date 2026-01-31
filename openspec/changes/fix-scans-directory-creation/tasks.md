# Tasks: Fix Scans Directory Creation UX

## Implementation Checklist (TDD Approach)

### Phase 1: Write Tests First (TDD)

- [ ] 1.1 Add test: saveConfig auto-creates non-existent scans directory
- [ ] 1.2 Add test: saveConfig auto-creates nested parent directories
- [ ] 1.3 Add test: saveConfig succeeds with existing writable directory
- [ ] 1.4 Add test: Validation checks parent directory writability
- [ ] 1.5 Add test: Validation fails with clear error for non-writable parent
- [ ] 1.6 Run tests: `npm run test:unit` - expect 5 failures ❌

### Phase 2: Update Validation Logic (TDD)

- [ ] 2.1 Update `validateConfig()` in src/main/config-store.ts
- [ ] 2.2 For existing directories: check writability (unchanged)
- [ ] 2.3 For non-existent directories: check parent exists and is writable
- [ ] 2.4 Provide clear error messages with parent path
- [ ] 2.5 Run validation tests - expect validation tests to pass ✅

### Phase 3: Add Directory Auto-creation (TDD)

- [ ] 3.1 Update `saveConfig()` in src/main/config-store.ts
- [ ] 3.2 After validation, before writing .env file
- [ ] 3.3 Check if scans_dir exists with `fs.existsSync()`
- [ ] 3.4 If not exists, create with `fs.mkdirSync(scans_dir, { recursive: true })`
- [ ] 3.5 Add console logging for directory creation
- [ ] 3.6 Wrap in try-catch, throw descriptive error on failure
- [ ] 3.7 Run saveConfig tests - expect auto-creation tests to pass ✅

### Phase 4: Integration with Existing Tests

- [ ] 4.1 Update existing config-store tests that create temp directories
- [ ] 4.2 Verify tests still clean up properly
- [ ] 4.3 Run full test suite: `npm run test:unit` - expect all tests to pass ✅
- [ ] 4.4 Run TypeScript compiler: `npx tsc --noEmit` - expect no errors ✅

### Phase 5: Manual Testing

- [ ] 5.1 Test: Delete ~/.bloom/ directory
- [ ] 5.2 Test: Start app in development mode
- [ ] 5.3 Test: Configure scans directory to ~/.bloom/dev-scans
- [ ] 5.4 Test: Save configuration (should succeed)
- [ ] 5.5 Test: Verify ~/.bloom/dev-scans directory was created
- [ ] 5.6 Test: Configure scans directory to /root/scans
- [ ] 5.7 Test: Verify validation error with clear parent path message
- [ ] 5.8 Test: Create external directory /tmp/test-scans
- [ ] 5.9 Test: Configure scans directory and verify save succeeds

### Phase 6: Code Quality and Cleanup

- [ ] 6.1 Add code comments explaining auto-creation logic
- [ ] 6.2 Run linter: `npm run lint` - fix any errors
- [ ] 6.3 Run formatter: `npm run format`
- [ ] 6.4 Verify console logging is appropriate (info, not error)

### Phase 7: Validate Spec

- [ ] 7.1 Run: `npx openspec validate fix-scans-directory-creation --strict`
- [ ] 7.2 Fix any validation errors
- [ ] 7.3 Confirm all scenarios covered by tests

## Acceptance Criteria

### Functional Requirements

- ✓ Non-existent scans directory is auto-created on save
- ✓ Nested parent directories created recursively
- ✓ Existing writable directories work unchanged
- ✓ Clear error messages when parent not writable
- ✓ No manual directory creation required

### Technical Requirements

- ✓ Uses `fs.mkdirSync(path, { recursive: true })` for creation
- ✓ Validation checks parent writability for non-existent dirs
- ✓ Error messages include specific parent directory path
- ✓ Console logging for directory creation events
- ✓ Try-catch error handling with descriptive messages
- ✓ No breaking changes to existing validation

### Testing Requirements

- ✓ 5 new unit tests pass (auto-creation, validation)
- ✓ Existing tests continue to pass
- ✓ Manual testing confirms UX improvement
- ✓ No regressions in existing functionality

## Files Modified

### Main Process

- `src/main/config-store.ts` - Update validateConfig() and saveConfig()

### Tests

- `tests/unit/config-store.test.ts` - Add auto-creation tests

### Spec

- `openspec/changes/fix-scans-directory-creation/proposal.md` - ✓ Created
- `openspec/changes/fix-scans-directory-creation/specs/configuration/spec.md` - ✓ Created
- `openspec/changes/fix-scans-directory-creation/tasks.md` - ✓ This file

## Technical Notes

### Validation Change

**Before (always require directory exists):**

```typescript
if (!fs.existsSync(config.scans_dir)) {
  errors.scans_dir = 'Directory does not exist or is not writable';
}
```

**After (check parent writability for non-existent):**

```typescript
if (fs.existsSync(config.scans_dir)) {
  // Directory exists - check if writable
  fs.accessSync(config.scans_dir, fs.constants.W_OK);
} else {
  // Directory doesn't exist - check parent is writable
  const parentDir = path.dirname(config.scans_dir);
  if (!fs.existsSync(parentDir)) {
    errors.scans_dir = `Parent directory does not exist: ${parentDir}`;
  } else {
    fs.accessSync(parentDir, fs.constants.W_OK);
  }
}
```

### saveConfig Addition

```typescript
// After validation passes, before writing .env
if (!fs.existsSync(config.scans_dir)) {
  console.log('[Config] Creating scans directory:', config.scans_dir);
  fs.mkdirSync(config.scans_dir, { recursive: true });
  console.log('[Config] Scans directory created successfully');
}
```

## Dependencies

- **Depends on**: `improve-database-scans-config` (completed - validation exists)
- **Blocks**: None
- **Related**: Machine configuration UX
