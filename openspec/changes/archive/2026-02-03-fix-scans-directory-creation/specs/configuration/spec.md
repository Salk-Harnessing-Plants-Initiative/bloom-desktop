# Spec Delta: Configuration - Auto-create Scans Directory

This spec delta fixes the UX issue where users cannot configure a non-existent scans directory.

## ADDED Requirements

### Requirement: Scans Directory Auto-creation

The application SHALL automatically create the scans directory when saving configuration, eliminating the need for manual directory creation.

#### Scenario: Auto-create scans directory on save

- **GIVEN** user has configured scans directory to `/home/user/.bloom/dev-scans`
- **AND** the directory does not exist
- **AND** the parent directory `/home/user/.bloom` exists and is writable
- **WHEN** user saves configuration
- **THEN** the application SHALL create the directory `/home/user/.bloom/dev-scans`
- **AND** configuration SHALL be saved successfully
- **AND** no validation error SHALL be shown

#### Scenario: Auto-create nested scans directory

- **GIVEN** user has configured scans directory to `/mnt/scanner-data/scans`
- **AND** the directory does not exist
- **AND** parent directories `/mnt/scanner-data` do not exist
- **AND** the root `/mnt` is writable
- **WHEN** user saves configuration
- **THEN** the application SHALL create all parent directories recursively
- **AND** the scans directory SHALL be created
- **AND** configuration SHALL be saved successfully

#### Scenario: Fail gracefully when parent not writable

- **GIVEN** user has configured scans directory to `/root/scans`
- **AND** the directory does not exist
- **AND** the parent directory `/root` is not writable by the application
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Cannot create directory - parent is not writable: /root"
- **AND** configuration SHALL NOT be saved
- **AND** no directory SHALL be created

#### Scenario: Succeed with existing writable directory

- **GIVEN** user has configured scans directory to `/home/user/.bloom/scans`
- **AND** the directory already exists
- **AND** the directory is writable
- **WHEN** user saves configuration
- **THEN** validation SHALL pass
- **AND** configuration SHALL be saved successfully
- **AND** no new directory SHALL be created

### Requirement: Improved Validation Error Messages

The application SHALL provide clear, actionable error messages when scans directory cannot be created.

#### Scenario: Clear error for non-writable parent

- **GIVEN** directory creation fails due to parent permissions
- **WHEN** validation error is shown
- **THEN** error message SHALL include parent directory path
- **AND** error message SHALL indicate parent is not writable
- **AND** format SHALL be "Cannot create directory - parent is not writable: {parent_path}"

#### Scenario: Clear error for invalid path

- **GIVEN** directory path is invalid or malformed
- **WHEN** validation runs
- **THEN** error message SHALL indicate the specific issue
- **AND** error message SHALL guide user to fix the path

## Technical Notes

### Directory Creation Logic

```typescript
// src/main/config-store.ts - in saveConfig() function

// Create scans directory if it doesn't exist
if (!fs.existsSync(config.scans_dir)) {
  try {
    console.log('[Config] Creating scans directory:', config.scans_dir);
    fs.mkdirSync(config.scans_dir, { recursive: true });
    console.log('[Config] Scans directory created successfully');
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to create scans directory: ${errorMessage}`);
  }
}
```

### Updated Validation Logic

```typescript
// src/main/config-store.ts - in validateConfig() function

// Validate scans_dir
if (!config.scans_dir || config.scans_dir.trim() === '') {
  errors.scans_dir = 'Scans directory is required';
} else {
  // Check if directory exists OR if parent is writable (so we can create it)
  try {
    if (fs.existsSync(config.scans_dir)) {
      // Directory exists - check if writable
      fs.accessSync(config.scans_dir, fs.constants.W_OK);
    } else {
      // Directory doesn't exist - check if parent is writable
      const parentDir = path.dirname(config.scans_dir);

      // Check parent exists
      if (!fs.existsSync(parentDir)) {
        errors.scans_dir = `Parent directory does not exist: ${parentDir}`;
      } else {
        // Check parent is writable
        fs.accessSync(parentDir, fs.constants.W_OK);
      }
    }
  } catch {
    if (fs.existsSync(config.scans_dir)) {
      errors.scans_dir = 'Directory is not writable';
    } else {
      const parentDir = path.dirname(config.scans_dir);
      errors.scans_dir = `Cannot create directory - parent is not writable: ${parentDir}`;
    }
  }
}
```

## Behavioral Changes

**Before:**

- User configures scans directory: `~/.bloom/dev-scans`
- Validation fails: "Directory does not exist or is not writable"
- User must manually create directory before saving

**After:**

- User configures scans directory: `~/.bloom/dev-scans`
- Validation checks parent directory is writable
- On save, directory is automatically created
- Configuration saves successfully

## Backward Compatibility

- Existing configurations with existing directories work unchanged
- No breaking changes to validation logic
- Only adds auto-creation functionality on save
