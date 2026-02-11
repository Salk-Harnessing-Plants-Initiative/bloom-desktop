# Design: Scanner Name Validation via Bloom API

## Overview

This design describes how the Machine Configuration page will fetch valid scanner names from the Bloom API and present them in a dropdown selector.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MachineConfiguration.tsx (Renderer)                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Scanner Name Dropdown                               │   │
│  │ [▼ Select a scanner...]                             │   │
│  │    - PBIOBScanner                                   │   │
│  │    - FastScanner                                    │   │
│  │    - SlowScanner                                    │   │
│  │    - Unknown                                        │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC: config:fetch-scanners
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Main Process (main.ts)                                     │
│  ipcMain.handle('config:fetch-scanners', ...)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP GET
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Bloom API                                                   │
│  GET https://api.bloom.salk.edu/proxy/scanners              │
│  Response: { data: [{ name: "PBIOBScanner" }, ...] }        │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Page Load (credentials exist)

```
1. MachineConfiguration mounts
2. Check if credentials exist (hasCredentials from config:get)
3. If credentials exist:
   a. Set scannerListLoading = true
   b. Call window.electron.config.fetchScanners()
   c. IPC handler fetches from Bloom API using stored credentials
   d. On success: populate dropdown, scannerListLoading = false
   e. On error: show error message, scannerListLoading = false
4. If no credentials: show credentials form first
```

### 2. First-Run Flow

```
1. No credentials exist → show credentials form
2. User enters credentials and saves
3. After successful save:
   a. Trigger scanner fetch
   b. Populate dropdown
   c. User can now select scanner
```

### 3. Retry on Error

```
1. API fetch fails (network error, auth error, etc.)
2. Show error message: "Failed to fetch scanners. Check your credentials and network connection."
3. Show "Retry" button
4. User clicks Retry → re-trigger fetch
```

## API Contract

### Request

```
GET {bloom_api_url}/scanners
Authorization: Bearer {access_token}
apikey: {bloom_anon_key}
```

### Response (Success)

```json
{
  "data": [
    { "name": "PBIOBScanner" },
    { "name": "FastScanner" },
    { "name": "SlowScanner" },
    { "name": "Unknown" }
  ]
}
```

### Response (Error)

```json
{
  "error": "Unauthorized",
  "message": "Invalid credentials"
}
```

## Type Definitions

```typescript
// src/types/electron.d.ts

export interface Scanner {
  name: string;
}

export interface FetchScannersResult {
  success: boolean;
  scanners?: Scanner[];
  error?: string;
}

export interface ConfigAPI {
  // ... existing methods ...
  fetchScanners: () => Promise<FetchScannersResult>;
}
```

## Component State

```typescript
// MachineConfiguration.tsx

// Scanner list state
const [scannerList, setScannerList] = useState<Scanner[]>([]);
const [scannerListLoading, setScannerListLoading] = useState(false);
const [scannerListError, setScannerListError] = useState<string | null>(null);

// Fetch scanners on mount (if credentials exist)
useEffect(() => {
  if (hasCredentials) {
    fetchScanners();
  }
}, [hasCredentials]);

const fetchScanners = async () => {
  setScannerListLoading(true);
  setScannerListError(null);

  try {
    const result = await window.electron.config.fetchScanners();
    if (result.success && result.scanners) {
      setScannerList(result.scanners);
    } else {
      setScannerListError(result.error || 'Failed to fetch scanners');
    }
  } catch (error) {
    setScannerListError('Failed to fetch scanners');
  } finally {
    setScannerListLoading(false);
  }
};
```

## UI States

### Loading State

```
Scanner Name
[Loading scanners...]  (disabled dropdown with spinner)
```

### Error State

```
Scanner Name
[Unable to load scanners]  (disabled dropdown)
⚠️ Failed to fetch scanners. Check your credentials and network connection.
[Retry]
```

### Success State

```
Scanner Name
[▼ PBIOBScanner]  (dropdown with options)
Scanner station registered in Bloom database
```

### No Credentials State

```
Scanner Name
[Enter credentials first]  (disabled dropdown)
Configure Bloom API credentials above to select a scanner.
```

## Security Considerations

1. **Read-only access**: The app only fetches the scanner list - it never creates, updates, or deletes scanners.

2. **Credential handling**: Bloom credentials are already stored securely in `~/.bloom/.env` and used for API authentication.

3. **No credential exposure**: Credentials are never sent to the renderer process. The fetch happens entirely in the main process.

## Test Strategy

### Unit Tests

1. `fetchScannersFromBloom()` function
   - Mock HTTP client
   - Test success response parsing
   - Test error handling
   - Test timeout handling

2. MachineConfiguration component
   - Mock `window.electron.config.fetchScanners()`
   - Test loading state
   - Test error state
   - Test success state with populated dropdown
   - Test scanner selection

### Integration Tests

1. IPC handler test
   - Mock Bloom API
   - Test end-to-end IPC flow

### E2E Tests

1. With mock API server
   - Test dropdown populated
   - Test selection persists
   - Test error handling
