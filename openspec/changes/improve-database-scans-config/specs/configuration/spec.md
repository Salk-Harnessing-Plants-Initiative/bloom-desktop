# Spec Delta: Configuration - Database and Scans Directory Improvements

This spec delta improves database and scans directory configuration for consistency and better admin guidance.

## MODIFIED Requirements

### Requirement: Development Environment Paths

The application SHALL use consistent path structure for development mode, keeping all development data under `~/.bloom/` separate from production data.

#### Scenario: Development database location

- **GIVEN** the application is running in development mode (`NODE_ENV=development`)
- **AND** no `BLOOM_DATABASE_URL` environment variable is set
- **WHEN** the database is initialized
- **THEN** the database SHALL be located at `~/.bloom/dev.db`
- **AND** the path SHALL NOT be in the project directory

#### Scenario: Development scans directory default

- **GIVEN** the application is running in development mode
- **AND** no saved configuration exists
- **WHEN** configuration defaults are loaded
- **THEN** the scans directory SHALL default to `~/.bloom/dev-scans`
- **AND** the path SHALL NOT conflict with production scans at `~/.bloom/scans`

#### Scenario: Production paths unchanged

- **GIVEN** the application is running in production mode
- **WHEN** paths are determined
- **THEN** database SHALL be at `~/.bloom/data/bloom.db`
- **AND** scans directory SHALL default to `~/.bloom/scans`
- **AND** behavior SHALL be identical to previous versions

### Requirement: Scans Directory Validation

The application SHALL validate that the configured scans directory exists and is writable before allowing the configuration to be saved.

#### Scenario: Writable directory validation success

- **GIVEN** user has configured scans directory to `/mnt/scanner-data`
- **AND** the directory exists
- **AND** the directory is writable by the application
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL pass
- **AND** configuration SHALL be saved successfully

#### Scenario: Non-existent directory validation failure

- **GIVEN** user has configured scans directory to `/nonexistent/path`
- **AND** the directory does not exist
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Directory does not exist or is not writable"
- **AND** configuration SHALL NOT be saved
- **AND** user SHALL be prompted to create the directory or choose a different path

#### Scenario: Non-writable directory validation failure

- **GIVEN** user has configured scans directory to `/root/scans`
- **AND** the directory exists
- **AND** the directory is not writable by the application user
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Directory does not exist or is not writable"
- **AND** configuration SHALL NOT be saved
- **AND** user SHALL be prompted to fix permissions or choose a different path

### Requirement: Scans Directory UI Guidance

The Machine Configuration form SHALL provide clear guidance about the scans directory field to help administrators make informed decisions during scanner station setup.

#### Scenario: Help text displayed

- **GIVEN** user is on Machine Configuration page
- **WHEN** viewing the scans directory field
- **THEN** help text SHALL be displayed below the input field
- **AND** help text SHALL explain "Default: ~/.bloom/scans (same location as database)"
- **AND** help text SHALL include guidance "For large datasets, configure external storage (e.g., /mnt/scanner-data)"

#### Scenario: Default value pre-filled

- **GIVEN** user is configuring scanner for the first time
- **WHEN** Machine Configuration form loads
- **THEN** scans directory field SHALL be pre-filled with default value
- **AND** default SHALL be `~/.bloom/scans` in production
- **AND** default SHALL be `~/.bloom/dev-scans` in development

#### Scenario: Existing value preserved

- **GIVEN** user has previously configured scans directory to `/mnt/scanner-data`
- **WHEN** Machine Configuration form loads
- **THEN** scans directory field SHALL display `/mnt/scanner-data`
- **AND** help text SHALL still be visible for reference

## Technical Notes

### Development Path Structure

```bash
# Development mode (NODE_ENV=development)
~/.bloom/
  ├── dev.db              # Database (new location)
  └── dev-scans/          # Scans (new default)

# Production mode
~/.bloom/
  ├── data/
  │   └── bloom.db        # Database (unchanged)
  └── scans/              # Scans (unchanged default)
```

### Database Initialization Logic

```typescript
// src/main/database.ts
const isDev = process.env.NODE_ENV === 'development';
if (isDev) {
  // Development: use dev.db in ~/.bloom/
  const homeDir = app.getPath('home');
  const bloomDir = path.join(homeDir, '.bloom');
  if (!fs.existsSync(bloomDir)) {
    fs.mkdirSync(bloomDir, { recursive: true });
  }
  dbPath = path.join(bloomDir, 'dev.db');
  console.log('[Database] Development mode - using:', dbPath);
} else {
  // Production: use bloom.db in ~/.bloom/data/ (unchanged)
  const homeDir = app.getPath('home');
  const bloomDir = path.join(homeDir, '.bloom', 'data');
  if (!fs.existsSync(bloomDir)) {
    fs.mkdirSync(bloomDir, { recursive: true });
  }
  dbPath = path.join(bloomDir, 'bloom.db');
  console.log('[Database] Production mode - using:', dbPath);
}
```

### Config Store Default Logic

```typescript
// src/main/config-store.ts
export function getDefaultConfig(): MachineConfig {
  const homeDir = os.homedir();
  const isDev = process.env.NODE_ENV === 'development';

  const scansDir = isDev
    ? path.join(homeDir, '.bloom', 'dev-scans')
    : path.join(homeDir, '.bloom', 'scans');

  return {
    scanner_name: '',
    camera_ip_address: 'mock',
    scans_dir: scansDir,
    bloom_api_url: 'https://api.bloom.salk.edu/proxy',
    bloom_scanner_username: '',
    bloom_scanner_password: '',
    bloom_anon_key: '',
  };
}
```

### Validation Logic

```typescript
// src/main/config-store.ts
// Add to validateConfig() function

// Validate scans_dir exists and is writable
if (!config.scans_dir || config.scans_dir.trim() === '') {
  errors.scans_dir = 'Scans directory is required';
} else {
  try {
    // Check if directory exists
    if (!fs.existsSync(config.scans_dir)) {
      errors.scans_dir = 'Directory does not exist or is not writable';
    } else {
      // Check if directory is writable
      fs.accessSync(config.scans_dir, fs.constants.W_OK);
    }
  } catch {
    errors.scans_dir = 'Directory does not exist or is not writable';
  }
}
```

### UI Help Text

```typescript
// src/renderer/MachineConfiguration.tsx

<div className="mb-4">
  <label htmlFor="scans-dir" className="block text-sm font-medium text-gray-700 mb-1">
    Scans Directory
  </label>
  <p className="text-xs text-gray-500 mb-2">
    Default: ~/.bloom/scans (same location as database)
    <br />
    For large datasets, configure external storage (e.g., /mnt/scanner-data)
  </p>
  <div className="flex gap-2">
    <input
      id="scans-dir"
      type="text"
      value={config.scans_dir}
      onChange={(e) =>
        setConfig((prev) => ({
          ...prev,
          scans_dir: e.target.value,
        }))
      }
      className={`flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        errors.scans_dir ? 'border-red-500' : 'border-gray-300'
      }`}
      placeholder="~/.bloom/scans"
    />
    <button
      onClick={handleBrowseScansDir}
      className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
    >
      Browse...
    </button>
  </div>
  {errors.scans_dir && (
    <p className="text-red-600 text-sm mt-1">{errors.scans_dir}</p>
  )}
</div>
```
