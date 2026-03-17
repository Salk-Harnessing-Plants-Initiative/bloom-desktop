# Change Proposal: Fix Scans Directory Creation UX

## Why

The current scans directory validation prevents users from saving a configuration with a non-existent directory, showing the error "Directory does not exist or is not writable". This creates a poor UX because:

1. **Chicken-and-egg problem**: Users must manually create the directory before they can configure it in the app
2. **Unclear error message**: The error doesn't guide users on how to fix it
3. **Inconsistent with database**: The database path is auto-created, but scans directory is not

This is especially problematic during initial scanner station setup when admins are configuring the system for the first time and the scans directory doesn't exist yet.

## What Changes

**Auto-create scans directory on save:**

- When user saves configuration with valid scans_dir path:
  - Attempt to create the directory (with recursive: true for parent dirs)
  - Only show error if creation fails due to permissions
- Update validation to check parent directory writability instead of target directory existence
- Provide clear error messages if directory cannot be created

**Improve error messages:**

- If parent directory doesn't exist: "Parent directory does not exist: {parent_path}"
- If parent directory not writable: "Cannot create directory - parent is not writable: {parent_path}"
- If directory creation fails: "Failed to create directory: {error_message}"

**No breaking changes** - existing configurations with existing directories continue to work exactly as before.

## Impact

**Affected specs:**

- `configuration` - Scans directory validation and creation

**Affected code:**

- `src/main/config-store.ts` - Update validateConfig() and saveConfig() to auto-create directory

**User impact:**

- Admins can configure scans directory without manually creating it first
- Clear error messages guide users if there are permission issues
- Consistent behavior with database path auto-creation
- Existing configurations unaffected
