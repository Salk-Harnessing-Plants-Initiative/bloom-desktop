## 1. Config Store Module (TDD)

### 1.1 Config Loading/Saving

- [ ] 1.1.1 Write unit tests for `loadConfig()` (valid file, missing file, invalid JSON)
- [ ] 1.1.2 Write unit tests for `saveConfig()` (creates directory, writes valid JSON)
- [ ] 1.1.3 Create `src/main/config-store.ts` with TypeScript interfaces
- [ ] 1.1.4 Implement `loadConfig()` to pass tests
- [ ] 1.1.5 Implement `saveConfig()` to pass tests

### 1.2 Credentials Loading/Saving

- [ ] 1.2.1 Write unit tests for `loadCredentials()` (valid .env, missing file)
- [ ] 1.2.2 Write unit tests for `saveCredentials()` (writes KEY=value format)
- [ ] 1.2.3 Implement `loadCredentials()` to pass tests
- [ ] 1.2.4 Implement `saveCredentials()` to pass tests

### 1.3 Config Validation

- [ ] 1.3.1 Write unit tests for `validateConfig()` (scanner name, camera IP, scans dir, URL)
- [ ] 1.3.2 Implement `validateConfig()` to pass tests

## 2. Config IPC Layer (TDD)

### 2.1 IPC Handlers

- [ ] 2.1.1 Write integration tests for `config:get` IPC handler
- [ ] 2.1.2 Write integration tests for `config:set` IPC handler
- [ ] 2.1.3 Write integration tests for `config:validate-credentials` IPC handler
- [ ] 2.1.4 Write integration tests for `config:test-camera` IPC handler
- [ ] 2.1.5 Write integration tests for `config:browse-directory` IPC handler
- [ ] 2.1.6 Add TypeScript types to `electron.d.ts`
- [ ] 2.1.7 Add config API to `preload.ts`
- [ ] 2.1.8 Implement IPC handlers in `main.ts` to pass tests

## 3. Machine Configuration UI (TDD)

### 3.1 Page Component

- [ ] 3.1.1 Write E2E test: page loads at `/machine-config` route
- [ ] 3.1.2 Write E2E test: form displays all config fields
- [ ] 3.1.3 Write E2E test: form pre-populates with current values
- [ ] 3.1.4 Create `MachineConfiguration.tsx` page component to pass tests
- [ ] 3.1.5 Add route to `App.tsx`

### 3.2 Form Validation

- [ ] 3.2.1 Write E2E test: validation errors display for invalid inputs
- [ ] 3.2.2 Write E2E test: save button disabled when validation fails
- [ ] 3.2.3 Implement form validation to pass tests

### 3.3 Save/Cancel Actions

- [ ] 3.3.1 Write E2E test: save persists config to disk
- [ ] 3.3.2 Write E2E test: cancel resets form to saved values
- [ ] 3.3.3 Implement save/cancel handlers to pass tests

### 3.4 Password Field

- [ ] 3.4.1 Write E2E test: password field is masked by default
- [ ] 3.4.2 Write E2E test: show/hide toggle reveals/masks password
- [ ] 3.4.3 Implement password field with toggle to pass tests

### 3.5 Test Connection Buttons

- [ ] 3.5.1 Write E2E test: camera test connection shows success/failure
- [ ] 3.5.2 Write E2E test: API test connection shows success/failure
- [ ] 3.5.3 Implement test connection buttons to pass tests

### 3.6 Directory Browser

- [ ] 3.6.1 Write E2E test: browse button opens native folder picker
- [ ] 3.6.2 Write E2E test: selected path populates scans directory field
- [ ] 3.6.3 Implement directory browser to pass tests

## 4. Access Control (TDD)

### 4.1 Keyboard Shortcut

- [ ] 4.1.1 Write E2E test: `Ctrl+Shift+,` navigates to `/machine-config`
- [ ] 4.1.2 Implement keyboard shortcut in main process to pass test

### 4.2 Credential Authentication

- [ ] 4.2.1 Write E2E test: first-run (no credentials) shows config form directly
- [ ] 4.2.2 Write E2E test: subsequent access shows login form
- [ ] 4.2.3 Write E2E test: correct credentials reveal config form
- [ ] 4.2.4 Write E2E test: incorrect credentials show error message
- [ ] 4.2.5 Implement authentication flow to pass tests

## 5. Integration (TDD)

### 5.1 Scanner Name Display

- [ ] 5.1.1 Write E2E test: sidebar displays configured scanner name
- [ ] 5.1.2 Write E2E test: sidebar shows "Not configured" when empty
- [ ] 5.1.3 Update `Layout.tsx` to pass tests

### 5.2 CaptureScan Integration

- [ ] 5.2.1 Write integration test: scan uses `scanner_name` from config
- [ ] 5.2.2 Write integration test: scan saves to `scans_dir` from config
- [ ] 5.2.3 Update `CaptureScan.tsx` to pass tests

### 5.3 Camera Settings Integration

- [ ] 5.3.1 Write E2E test: Camera Settings loads default camera IP from config
- [ ] 5.3.2 Write E2E test: temporary camera selection not persisted
- [ ] 5.3.3 Update `CameraSettingsForm.tsx` to pass tests

### 5.4 First-Run Detection

- [ ] 5.4.1 Write E2E test: no config redirects to `/machine-config`
- [ ] 5.4.2 Write E2E test: valid config navigates to home page
- [ ] 5.4.3 Implement first-run detection to pass tests

## 6. Documentation

- [ ] 6.1 Update `openspec/project.md` with design decisions
- [ ] 6.2 Create `docs/CONFIGURATION.md` with user documentation
