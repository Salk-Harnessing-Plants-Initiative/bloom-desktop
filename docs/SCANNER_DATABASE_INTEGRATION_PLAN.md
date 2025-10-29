# Scanner-Database Integration Plan (Issue #53)

**Status**: Planning Complete
**Branch**: `elizabeth/scanner-database-integration`
**Estimated Time**: 4-5 hours
**Priority**: High

## Table of Contents
1. [Overview](#overview)
2. [Current State](#current-state)
3. [Goals](#goals)
4. [Architecture](#architecture)
5. [Implementation Phases](#implementation-phases)
6. [Testing Strategy](#testing-strategy)
7. [Risk Mitigation](#risk-mitigation)
8. [Acceptance Criteria](#acceptance-criteria)

---

## Overview

Integrate the Scanner process with the database to automatically persist scan metadata and image records after each scan completes. This enables:
- Scan history tracking
- Association with experiments and phenotypers
- Foundation for BrowseScans UI
- Data persistence for research workflows

**Dependencies:**
- ✅ PR #52 (Database setup) - MERGED
- ✅ PR #48 (Scanner implementation) - MERGED

---

## Current State

### What We Have ✅
- Database infrastructure with Prisma + SQLite
- 15 database IPC handlers (experiments, scans, images, etc.)
- Scanner backend (captures images via camera + DAQ)
- Scanner IPC handlers (initialize, scan, status, cleanup)
- Scan and Image models in database schema (100% pilot-compatible)

### What's Missing ❌
- Scanner doesn't persist data to database
- No metadata collection (experiment_id, phenotyper_id, plant_id, wave_number, plant_age_days)
- UI doesn't pass context to scanner
- No scan history tracking
- Image records not created automatically

### Scanner Analysis

**Current Scanner Flow:**
```
UI calls scanner:initialize(settings)
  → Scanner configures camera + DAQ
  → UI calls scanner:scan()
  → Scanner captures 72 frames
  → Scanner emits progress events (0-71)
  → Scanner returns ScanResult {success, frames_captured, output_path}
  → [NO DATABASE WRITE]
```

**Scanner Capabilities:**
- ✅ Captures images and saves to disk
- ✅ Returns image paths via ScanProgress events
- ✅ Provides scan completion status
- ✅ Stores camera/DAQ settings during initialization
- ❌ No database integration
- ❌ No metadata beyond settings

---

## Goals

1. **Automatic Scan Persistence**: Create Scan record after successful scan
2. **Image Tracking**: Create Image records for all 72 captured frames
3. **Metadata Association**: Link scans to experiments, phenotypers, and plants
4. **Error Resilience**: Handle failures gracefully (no partial data)
5. **Testing**: Comprehensive integration tests for scanner → database workflow

---

## Architecture

### Data Flow Diagram

```
┌──────────────────┐
│   UI (Renderer)  │
│  CaptureScan.tsx │
└────────┬─────────┘
         │ 1. scanner:initialize(settings + metadata)
         ▼
┌──────────────────┐
│  Main Process    │
│  IPC Handler     │
└────────┬─────────┘
         │ 2. Pass to scanner
         ▼
┌──────────────────┐
│ ScannerProcess   │
│  - Stores settings & metadata
│  - Collects progress events
└────────┬─────────┘
         │ 3. Calls Python backend
         ▼
┌──────────────────┐
│ Python Scanner   │
│  - Captures images
│  - Returns ScanResult
└────────┬─────────┘
         │ 4. On success
         ▼
┌──────────────────┐
│ saveScanToDatabase()
│  - Create Scan record
│  - Bulk create Images
└────────┬─────────┘
         │ 5. Returns scan_id
         ▼
┌──────────────────┐
│  SQLite Database │
│  - Scan record
│  - 72 Image records
└──────────────────┘
```

### Pilot Implementation Pattern

**Key findings from pilot codebase**:

1. **Nested Create Pattern** - Scan + Images created atomically:
```typescript
await prisma.scan.create({
  data: {
    ...scanMetadata,
    images: { create: imagesArray }  // Nested create
  }
})
```

2. **Error Handling** - Return error tuples instead of throwing:
```typescript
try {
  const scan = await prisma.scan.create({...})
  return { error: null, data: scan }
} catch (err) {
  return { error: err, data: null }
}
```

3. **Batch Operations** - Create all related data in single operation (atomic)

**We will adopt this pattern** for better atomicity and pilot compatibility.

### Database Schema (from PR #52)

**Scan Table** (all fields required except accession_id):
```prisma
model Scan {
  id              String     @id @default(uuid())
  experiment_id   String     // From UI context
  phenotyper_id   String     // From user session
  scanner_name    String     // Machine identifier
  plant_id        String     // From UI input
  accession_id    String?    // Optional
  path            String     // From ScanResult.output_path
  capture_date    DateTime   @default(now())
  num_frames      Int        // From ScanResult.frames_captured
  exposure_time   Int        // From camera settings
  gain            Float      // From camera settings
  brightness      Float      // From camera settings
  contrast        Float      // From camera settings
  gamma           Float      // From camera settings
  seconds_per_rot Float      // From DAQ settings
  wave_number     Int        // From UI input
  plant_age_days  Int        // From UI input
  deleted         Boolean    @default(false)
  images          Image[]
  phenotyper      Phenotyper @relation(...)
  experiment      Experiment @relation(...)
}
```

**Image Table**:
```prisma
model Image {
  id           String  @id @default(uuid())
  scan_id      String  // Foreign key
  frame_number Int     // 0-71
  path         String  // From ScanProgress.image_path
  status       String  @default("pending")
  scan         Scan    @relation(...)
}
```

---

## Implementation Phases

### Phase 1: Extend Scanner Types (30 minutes)

**File**: `src/types/scanner.ts`

**Add ScanMetadata interface**:
```typescript
export interface ScanMetadata {
  experiment_id: string
  phenotyper_id: string
  plant_id: string
  scanner_name: string
  wave_number: number
  plant_age_days: number
  accession_id?: string  // Optional
}
```

**Update ScannerSettings**:
```typescript
export interface ScannerSettings {
  camera: CameraSettings
  daq: DAQSettings
  num_frames?: number
  output_path?: string
  metadata: ScanMetadata  // NEW - required
}
```

**Update ScanResult**:
```typescript
export interface ScanResult {
  success: boolean
  frames_captured: number
  output_path: string
  error?: string
  scan_id?: string  // NEW - database ID after save
}
```

**Testing**: TypeScript compilation passes

---

### Phase 2: Update Scanner Process (1-1.5 hours)

**File**: `src/main/scanner-process.ts`

**Changes**:

1. **Import database**:
```typescript
import { getDatabase } from './database'
import type { Prisma } from '@prisma/client'
```

2. **Store settings and progress**:
```typescript
export class ScannerProcess extends EventEmitter {
  private settings?: ScannerSettings
  private progressEvents: ScanProgress[] = []

  async initialize(settings: ScannerSettings): Promise<...> {
    this.settings = settings  // Store for DB write
    this.progressEvents = []  // Reset collection
    // ... existing initialization
  }

  private handlePythonMessage(message: PythonMessage): void {
    if (message.type === 'scanner:progress') {
      const progress = message.payload as ScanProgress
      this.progressEvents.push(progress)  // Collect
      this.emit('progress', progress)
    }
    // ... rest
  }
}
```

3. **Add database save method**:
```typescript
async scan(): Promise<ScanResult> {
  const result = await this.pythonProcess.sendCommand({
    command: 'scanner',
    action: 'scan',
  })

  // Save to database on success
  if (result.success && this.settings) {
    try {
      const scan_id = await this.saveScanToDatabase(result)
      result.scan_id = scan_id
      console.log(`[Scanner] Saved scan to database: ${scan_id}`)
    } catch (error) {
      console.error('[Scanner] Failed to save to database:', error)
      // Don't fail the scan itself - it already succeeded
    }
  }

  this.emit('complete', result)
  return result
}

private async saveScanToDatabase(result: ScanResult): Promise<string> {
  if (!this.settings) {
    throw new Error('Settings not initialized - cannot save scan')
  }

  const db = getDatabase()
  const { camera, daq, metadata } = this.settings

  // Create Scan record
  const scan = await db.scan.create({
    data: {
      experiment_id: metadata.experiment_id,
      phenotyper_id: metadata.phenotyper_id,
      plant_id: metadata.plant_id,
      scanner_name: metadata.scanner_name,
      wave_number: metadata.wave_number,
      plant_age_days: metadata.plant_age_days,
      accession_id: metadata.accession_id || null,
      path: result.output_path,
      num_frames: result.frames_captured,
      exposure_time: camera.exposure_time,
      gain: camera.gain,
      brightness: camera.brightness || 0.5,
      contrast: camera.contrast || 1.0,
      gamma: camera.gamma || 1.0,
      seconds_per_rot: daq.seconds_per_rot,
      // capture_date defaults to now()
      // deleted defaults to false
    },
  })

  // Create Image records in bulk
  const images: Prisma.ImageCreateManyInput[] = this.progressEvents
    .filter(p => p.image_path)  // Only frames with paths
    .map(p => ({
      scan_id: scan.id,
      frame_number: p.frame_number,
      path: p.image_path!,
      status: 'completed',
    }))

  if (images.length > 0) {
    await db.image.createMany({ data: images })
    console.log(`[Scanner] Created ${images.length} image records`)
  }

  return scan.id
}
```

**Testing**:
- Unit test: Mock database, verify correct data structure
- Error handling: DB failure doesn't crash scanner

---

### Phase 3: Update Type Definitions (15 minutes)

**File**: `src/types/electron.d.ts`

**Update ScannerAPI**:
```typescript
export interface ScannerAPI {
  initialize: (settings: ScannerSettings) => Promise<{ success: boolean; initialized: boolean }>
  scan: () => Promise<ScanResult>  // Now includes scan_id
  cleanup: () => Promise<{ success: boolean; initialized: boolean }>
  getStatus: () => Promise<ScannerStatus>
  onProgress: (callback: (progress: ScanProgress) => void) => void
  onComplete: (callback: (result: ScanResult) => void) => void
  onError: (callback: (error: string) => void) => void
}
```

**No changes needed**:
- `src/main/main.ts` - IPC handler already passes full settings
- `src/main/preload.ts` - Already exposes scanner.initialize(settings)

**Testing**: TypeScript compilation passes

---

### Phase 4: Update UI (Temporary Implementation) (30 minutes)

**File**: `src/renderer/CaptureScan.tsx`

**Add metadata form fields** (temporary - will be replaced with proper experiment selection in future):

```typescript
const [metadata, setMetadata] = useState<ScanMetadata>({
  experiment_id: '',
  phenotyper_id: '',
  plant_id: '',
  scanner_name: 'scanner-01',  // Default
  wave_number: 1,
  plant_age_days: 0,
})

// Add form section
<div className="metadata-section">
  <h3>Scan Metadata (Required)</h3>

  <label>
    Experiment ID:
    <input
      type="text"
      value={metadata.experiment_id}
      onChange={(e) => setMetadata({...metadata, experiment_id: e.target.value})}
      required
    />
  </label>

  <label>
    Phenotyper ID:
    <input
      type="text"
      value={metadata.phenotyper_id}
      onChange={(e) => setMetadata({...metadata, phenotyper_id: e.target.value})}
      required
    />
  </label>

  <label>
    Plant ID:
    <input
      type="text"
      value={metadata.plant_id}
      onChange={(e) => setMetadata({...metadata, plant_id: e.target.value})}
      placeholder="e.g., PLANT-001"
      required
    />
  </label>

  <label>
    Wave Number:
    <input
      type="number"
      value={metadata.wave_number}
      onChange={(e) => setMetadata({...metadata, wave_number: parseInt(e.target.value)})}
      min="1"
      required
    />
  </label>

  <label>
    Plant Age (days):
    <input
      type="number"
      value={metadata.plant_age_days}
      onChange={(e) => setMetadata({...metadata, plant_age_days: parseInt(e.target.value)})}
      min="0"
      required
    />
  </label>
</div>

// Update scan handler
const handleStartScan = async () => {
  // Validate metadata
  if (!metadata.experiment_id || !metadata.phenotyper_id || !metadata.plant_id) {
    alert('Please fill in all required metadata fields')
    return
  }

  try {
    await window.electron.scanner.initialize({
      camera: cameraSettings,
      daq: daqSettings,
      num_frames: 72,
      metadata: metadata,  // Pass metadata
    })

    const result = await window.electron.scanner.scan()

    if (result.success) {
      console.log('Scan completed successfully!')
      if (result.scan_id) {
        console.log('Saved to database with ID:', result.scan_id)
        // Future: Navigate to scan details page
      }
    } else {
      console.error('Scan failed:', result.error)
    }
  } catch (error) {
    console.error('Scan error:', error)
  }
}
```

**Note**: This is a temporary UI. Future PRs will add:
- Experiment dropdown/selection
- Automatic phenotyper_id from logged-in user
- Plant barcode scanner
- Better form validation

**Testing**: Manual test - fill form, run scan, check Prisma Studio

---

### Phase 5: Integration Tests (1.5 hours)

**File**: `tests/integration/test-scanner-database.ts` (NEW)

**Create comprehensive test suite**:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ScannerProcess } from '../../src/main/scanner-process'
import { PythonProcess } from '../../src/main/python-process'

const prisma = new PrismaClient()

async function cleanDatabase() {
  await prisma.image.deleteMany()
  await prisma.scan.deleteMany()
  // Don't delete experiments/phenotypers - they're test fixtures
}

describe('Scanner-Database Integration', () => {
  let scanner: ScannerProcess
  let pythonProcess: PythonProcess
  let testExperimentId: string
  let testPhenotyperId: string

  beforeEach(async () => {
    await cleanDatabase()

    // Create test fixtures
    const experiment = await prisma.experiment.create({
      data: { name: 'Test Experiment', species: 'Arabidopsis' }
    })
    testExperimentId = experiment.id

    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Test Phenotyper', email: 'test@example.com' }
    })
    testPhenotyperId = phenotyper.id

    // Initialize scanner
    pythonProcess = new PythonProcess()
    await pythonProcess.start()
    scanner = new ScannerProcess(pythonProcess)
  })

  afterEach(async () => {
    await scanner.cleanup()
    await pythonProcess.stop()
    await cleanDatabase()
  })

  it('should create Scan record after successful scan', async () => {
    await scanner.initialize({
      camera: {
        exposure_time: 10000,
        gain: 0,
        camera_ip_address: 'mock',
      },
      daq: {
        device_name: 'mock',
        sampling_rate: 1000,
        step_pin: 0,
        dir_pin: 1,
        steps_per_revolution: 200,
        num_frames: 72,
        seconds_per_rot: 60,
      },
      metadata: {
        experiment_id: testExperimentId,
        phenotyper_id: testPhenotyperId,
        plant_id: 'TEST-PLANT-001',
        scanner_name: 'test-scanner',
        wave_number: 1,
        plant_age_days: 30,
      }
    })

    const result = await scanner.scan()

    expect(result.success).toBe(true)
    expect(result.scan_id).toBeDefined()

    // Verify Scan record
    const scan = await prisma.scan.findUnique({
      where: { id: result.scan_id },
      include: { images: true, experiment: true, phenotyper: true }
    })

    expect(scan).toBeDefined()
    expect(scan!.plant_id).toBe('TEST-PLANT-001')
    expect(scan!.wave_number).toBe(1)
    expect(scan!.plant_age_days).toBe(30)
    expect(scan!.num_frames).toBe(72)
    expect(scan!.exposure_time).toBe(10000)
    expect(scan!.experiment.name).toBe('Test Experiment')
    expect(scan!.phenotyper.email).toBe('test@example.com')
  })

  it('should create 72 Image records with correct frame_numbers', async () => {
    // ... initialize and scan

    const result = await scanner.scan()

    const images = await prisma.image.findMany({
      where: { scan_id: result.scan_id },
      orderBy: { frame_number: 'asc' }
    })

    expect(images).toHaveLength(72)

    images.forEach((img, idx) => {
      expect(img.frame_number).toBe(idx)
      expect(img.status).toBe('completed')
      expect(img.path).toContain('.tiff')
    })
  })

  it('should not create database records if scan fails', async () => {
    // Mock scanner to fail
    jest.spyOn(pythonProcess, 'sendCommand').mockResolvedValueOnce({
      success: false,
      error: 'Mock scanner failure'
    })

    const initialScanCount = await prisma.scan.count()
    const initialImageCount = await prisma.image.count()

    await scanner.initialize({ /* settings */ })
    const result = await scanner.scan()

    expect(result.success).toBe(false)
    expect(result.scan_id).toBeUndefined()

    const finalScanCount = await prisma.scan.count()
    const finalImageCount = await prisma.image.count()

    expect(finalScanCount).toBe(initialScanCount)
    expect(finalImageCount).toBe(initialImageCount)
  })

  it('should handle database failure gracefully', async () => {
    // Mock database to fail
    jest.spyOn(prisma.scan, 'create').mockRejectedValueOnce(
      new Error('Mock database error')
    )

    await scanner.initialize({ /* settings */ })
    const result = await scanner.scan()

    // Scan reports success even if DB fails
    expect(result.success).toBe(true)
    expect(result.scan_id).toBeUndefined()

    // Check console.error was called
    // (requires spy on console.error)
  })

  it('should store all camera settings correctly', async () => {
    const cameraSettings = {
      exposure_time: 15000,
      gain: 10,
      brightness: 0.7,
      contrast: 1.3,
      gamma: 0.9,
      camera_ip_address: 'mock',
    }

    await scanner.initialize({
      camera: cameraSettings,
      daq: { /* daq settings */ },
      metadata: { /* metadata */ }
    })

    const result = await scanner.scan()
    const scan = await prisma.scan.findUnique({
      where: { id: result.scan_id }
    })

    expect(scan!.exposure_time).toBe(15000)
    expect(scan!.gain).toBe(10)
    expect(scan!.brightness).toBe(0.7)
    expect(scan!.contrast).toBe(1.3)
    expect(scan!.gamma).toBe(0.9)
  })

  it('should handle optional accession_id', async () => {
    // Test with accession
    await scanner.initialize({
      camera: { /* camera */ },
      daq: { /* daq */ },
      metadata: {
        experiment_id: testExperimentId,
        phenotyper_id: testPhenotyperId,
        plant_id: 'PLANT-001',
        scanner_name: 'scanner-01',
        wave_number: 1,
        plant_age_days: 15,
        accession_id: 'ACC-123',  // Optional field
      }
    })

    const result = await scanner.scan()
    const scan = await prisma.scan.findUnique({
      where: { id: result.scan_id }
    })

    expect(scan!.accession_id).toBe('ACC-123')
  })

  it('should set capture_date to current time', async () => {
    const beforeScan = new Date()

    await scanner.initialize({ /* settings */ })
    const result = await scanner.scan()

    const afterScan = new Date()

    const scan = await prisma.scan.findUnique({
      where: { id: result.scan_id }
    })

    const captureDate = new Date(scan!.capture_date)
    expect(captureDate.getTime()).toBeGreaterThanOrEqual(beforeScan.getTime())
    expect(captureDate.getTime()).toBeLessThanOrEqual(afterScan.getTime())
  })
})
```

**Add to package.json**:
```json
"scripts": {
  "test:scanner-db": "npm run build:python && vitest run tests/integration/test-scanner-database.ts"
}
```

**Testing Goals**:
- ✅ 7+ test scenarios
- ✅ All scenarios pass
- ✅ Coverage for success, failure, edge cases

---

### Phase 6: Documentation Updates (30 minutes)

**File**: `docs/DATABASE.md`

**Add Scanner Integration section**:

```markdown
## Scanner Integration

The scanner automatically saves scan records to the database after each successful scan.

### Required Metadata

When initializing the scanner, you must provide metadata:

\`\`\`typescript
await window.electron.scanner.initialize({
  camera: {
    exposure_time: 10000,
    gain: 0,
    camera_ip_address: '10.0.0.45',
    brightness: 0.5,
    contrast: 1.0,
    gamma: 1.0,
  },
  daq: {
    device_name: 'cDAQ1Mod1',
    sampling_rate: 1000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 200,
    num_frames: 72,
    seconds_per_rot: 60,
  },
  metadata: {
    experiment_id: 'uuid-of-experiment',      // Required
    phenotyper_id: 'uuid-of-phenotyper',      // Required
    plant_id: 'PLANT-001',                    // Required
    scanner_name: 'scanner-01',               // Required
    wave_number: 1,                           // Required
    plant_age_days: 30,                       // Required
    accession_id: 'optional-uuid',            // Optional
  }
})
\`\`\`

### After Scanning

The scan result includes the database record ID:

\`\`\`typescript
const result = await window.electron.scanner.scan()

if (result.success && result.scan_id) {
  console.log('Scan saved with ID:', result.scan_id)

  // Fetch full scan record with images
  const response = await window.electron.database.scans.get(result.scan_id)

  if (response.success) {
    console.log(`Scan has ${response.data.images.length} images`)
    console.log('Experiment:', response.data.experiment.name)
    console.log('Phenotyper:', response.data.phenotyper.name)
  }
}
\`\`\`

### Viewing Scans

Use Prisma Studio to browse saved scans:

\`\`\`bash
npm run prisma:studio
\`\`\`

Navigate to the Scan table to see all captured scans with their metadata.
```

**File**: `README.md`

**Update test count**:
```markdown
- **TypeScript Unit Tests**: 48 tests (path sanitizer + database)
- **TypeScript Integration Tests**: 7+ tests (scanner-database)
```

---

## Testing Strategy

### Unit Tests
- Scanner process methods (saveScanToDatabase)
- Correct Prisma data structure
- Error handling (missing settings, DB failures)

### Integration Tests (7+ scenarios)
1. ✅ Successful scan creates Scan + Images
2. ✅ 72 Image records with correct frame_numbers
3. ✅ All metadata fields populated correctly
4. ✅ Camera/DAQ settings stored correctly
5. ✅ Scan failure → no DB records
6. ✅ DB failure → scan succeeds, no crash
7. ✅ Optional accession_id handled
8. ✅ capture_date set to current time

### Manual Tests
- Run scan with mock camera
- Fill metadata form in UI
- Check Prisma Studio for records
- Verify image paths exist on disk
- Verify foreign key relationships
- Test with real camera (if available)

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database write slows scan | Medium | Write happens AFTER scan completes, doesn't block |
| Missing metadata breaks scan | High | TypeScript enforces required fields, UI validation |
| Partial data on crash | Low | Scan succeeds independently; DB failure logged |
| UI changes break tests | Medium | Tests use programmatic API, not UI |
| Increased test time | Low | Integration tests run separately from unit tests |

---

## Acceptance Criteria

- [ ] Scanner creates Scan record after successful scan
- [ ] 72 Image records created with correct frame_number and paths
- [ ] All metadata fields populated (experiment, phenotyper, plant, wave, age)
- [ ] Camera settings stored (exposure, gain, brightness, contrast, gamma)
- [ ] DAQ settings stored (seconds_per_rot)
- [ ] Foreign key relationships work (scan → experiment, scan → phenotyper)
- [ ] Scan failure doesn't create partial DB records
- [ ] Database failure doesn't crash scanner (logs error)
- [ ] 7+ integration tests pass
- [ ] All existing tests still pass (48 unit tests)
- [ ] Documentation updated (DATABASE.md, README.md)
- [ ] Manual test: Scan → Prisma Studio shows records

---

## Files to Create/Modify

### Create
- `tests/integration/test-scanner-database.ts` - Integration test suite

### Modify
- `src/types/scanner.ts` - Add ScanMetadata, update ScannerSettings/ScanResult
- `src/main/scanner-process.ts` - Add database write logic (saveScanToDatabase)
- `src/types/electron.d.ts` - Update ScanResult type in API
- `src/renderer/CaptureScan.tsx` - Add metadata form (temporary)
- `docs/DATABASE.md` - Add scanner integration section
- `README.md` - Update test count
- `package.json` - Add test:scanner-db script

### No Changes Needed
- `src/main/main.ts` - IPC handler already correct
- `src/main/preload.ts` - Already passes settings through
- `prisma/schema.prisma` - Schema already correct

---

## Implementation Checklist

### Phase 1: Types (30 min)
- [ ] Add ScanMetadata interface
- [ ] Update ScannerSettings with metadata field
- [ ] Update ScanResult with scan_id field
- [ ] Verify TypeScript compilation

### Phase 2: Scanner Process (1-1.5 hours)
- [ ] Import database functions
- [ ] Store settings in scanner instance
- [ ] Collect progress events
- [ ] Implement saveScanToDatabase method
- [ ] Update scan() to call saveScanToDatabase
- [ ] Add error handling (log, don't crash)
- [ ] Test with mock database

### Phase 3: Type Definitions (15 min)
- [ ] Update electron.d.ts ScannerAPI
- [ ] Verify no other type changes needed
- [ ] Verify TypeScript compilation

### Phase 4: UI (30 min)
- [ ] Add metadata state
- [ ] Add metadata form fields
- [ ] Update handleStartScan to pass metadata
- [ ] Add validation
- [ ] Manual test with UI

### Phase 5: Integration Tests (1.5 hours)
- [ ] Create test file
- [ ] Setup/teardown with clean database
- [ ] Test: Successful scan → Scan + Images created
- [ ] Test: 72 images with correct data
- [ ] Test: Scan failure → no records
- [ ] Test: DB failure → graceful handling
- [ ] Test: Camera settings stored
- [ ] Test: Optional accession_id
- [ ] Test: capture_date timestamp
- [ ] Add test:scanner-db script
- [ ] All tests pass

### Phase 6: Documentation (30 min)
- [ ] Update DATABASE.md with scanner integration
- [ ] Update README.md test count
- [ ] Add code examples
- [ ] Review for clarity

### Final Steps
- [ ] Run all tests (npm run test:unit && npm run test:scanner-db)
- [ ] Run lint (npm run lint)
- [ ] Run format (npm run format)
- [ ] Manual test with real scan
- [ ] Check Prisma Studio for data
- [ ] Create PR with comprehensive description
- [ ] Request review

---

## Future Enhancements (Not in this PR)

1. **Experiment Selection UI** - Dropdown instead of manual ID
2. **User Authentication** - Automatic phenotyper_id from session
3. **Plant Barcode Scanner** - QR/barcode input for plant_id
4. **Accession Auto-lookup** - Fetch from plant_id
5. **Scan Preview** - Show captured frames in real-time
6. **Scan Validation** - Prevent duplicate scans
7. **Database Transaction** - Atomic Scan + Images creation
8. **Retry Logic** - Retry DB write on transient failures
9. **Scan Metadata Editor** - Edit metadata after scan
10. **Export Functionality** - Export scan data to CSV/JSON

---

## Notes

- **Pilot Compatibility**: Schema 100% matches pilot (PR #52)
- **Scanner Name**: Hardcoded to 'scanner-01' for now (future: machine config UI)
- **Error Philosophy**: Scanner success is independent of DB write success
- **Performance**: Bulk insert for images (single DB call for 72 records)
- **Atomicity**: Not using transactions initially (can add if needed)
- **Logging**: Comprehensive logging for debugging

---

## References

- [Issue #53](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/53) - Original issue
- [PR #52](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/52) - Database setup
- [PR #48](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/pull/48) - Scanner implementation
- [Prisma Documentation](https://www.prisma.io/docs/)
- [docs/DATABASE.md](DATABASE.md) - Database documentation
- [docs/SCANNER_TESTING.md](SCANNER_TESTING.md) - Scanner testing guide

---

**Last Updated**: 2025-10-28
**Author**: Elizabeth Berrigan + Claude Code
**Status**: Ready for Implementation


## Pilot Pattern Update (Added 2025-10-28)

After reviewing the pilot implementation, we will use **Prisma's nested create** for atomic Scan + Images creation:

```typescript
// Use nested create instead of separate operations
const scan = await db.scan.create({
  data: {
    ...scanFields,
    images: {
      create: imagesArray  // Creates all images atomically with scan
    }
  }
})
```

This provides better atomicity - either all records are created or none are (transaction-like behavior).

