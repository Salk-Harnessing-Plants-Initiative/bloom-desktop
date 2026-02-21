# Manual Upload Testing Guide

This guide explains how to manually test the image upload functionality to Bloom remote storage.

## Prerequisites

### 1. Configure Bloom Credentials

Upload requires valid Bloom credentials in `~/.bloom/.env`:

```bash
# Machine Configuration
SCANNER_NAME=YourScannerName
CAMERA_IP_ADDRESS=10.0.0.50
SCANS_DIR=/path/to/your/scans

# Bloom API Settings (required for upload)
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
BLOOM_SCANNER_USERNAME=your_scanner@salk.edu
BLOOM_SCANNER_PASSWORD=your_password
BLOOM_ANON_KEY=your_anon_key
```

You can configure these through the Machine Configuration page in the app, or edit the file directly.

### 2. Have Scans with Images

You need at least one scan with images in the local database. Images should exist at the paths stored in the `Image.path` column.

## Testing via Developer Console

### Single Scan Upload

1. Start the app: `npm run start`
2. Open DevTools: `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux)
3. Navigate to the Console tab
4. Get a scan ID from Browse Scans page, or query:

```javascript
// List scans to find one with images
const result = await window.electron.database.scans.list({
  page: 1,
  pageSize: 10,
});
console.log(
  result.data.scans.map((s) => ({
    id: s.id,
    plant_id: s.plant_id,
    images: s.images.length,
  }))
);
```

5. Upload a single scan:

```javascript
const scanId = 'your-scan-id-here';
const uploadResult = await window.electron.database.scans.upload(scanId);
console.log(uploadResult);
```

**Expected response (success):**

```javascript
{
  success: true,
  data: {
    success: true,
    scanId: 'your-scan-id',
    uploaded: 72,    // number of images uploaded
    failed: 0,       // number of failures
    total: 72,       // total images in scan
    errors: []       // error messages if any
  }
}
```

**Expected response (credentials error):**

```javascript
{
  success: false,
  error: 'Missing Bloom credentials'
}
```

### Batch Upload

```javascript
const scanIds = ['scan-id-1', 'scan-id-2', 'scan-id-3'];
const batchResult = await window.electron.database.scans.uploadBatch(scanIds);
console.log(batchResult);
```

**Expected response:**

```javascript
{
  success: true,
  data: [
    { success: true, scanId: 'scan-id-1', uploaded: 72, failed: 0, total: 72, errors: [] },
    { success: true, scanId: 'scan-id-2', uploaded: 72, failed: 0, total: 72, errors: [] },
    { success: true, scanId: 'scan-id-3', uploaded: 72, failed: 0, total: 72, errors: [] }
  ]
}
```

## Verifying Upload Success

### Check Image Status in Database

After uploading, image statuses should be updated:

```javascript
// Get scan with images
const scan = await window.electron.database.scans.get('your-scan-id');
console.log(
  scan.data.images.map((img) => ({
    id: img.id,
    frame: img.frame_number,
    status: img.status,
  }))
);
```

**Image status values:**

- `pending` - Not yet uploaded
- `uploading` - Currently uploading (transient)
- `uploaded` - Successfully uploaded
- `failed` - Upload failed

### Check Supabase Storage

Images are uploaded to the `images` bucket in Supabase with path format:

```
scans/{scanId}/frame_{N}.png
```

You can verify via the Supabase dashboard or using the Supabase CLI.

## Troubleshooting

### "Missing Bloom credentials"

1. Check `~/.bloom/.env` exists and contains all required fields
2. Verify `BLOOM_SCANNER_USERNAME`, `BLOOM_SCANNER_PASSWORD`, and `BLOOM_ANON_KEY` are set
3. Restart the app after editing the config file

### "Authentication failed"

1. Verify your username/password are correct
2. Check if your account has access to the Bloom API
3. Ensure `BLOOM_API_URL` is correct (default: `https://api.bloom.salk.edu/proxy`)

### "Scan not found"

1. Verify the scan ID exists in the database
2. Check if the scan is soft-deleted (`deleted: true`)

### Images stuck in "uploading" status

If the app crashes during upload, images may be stuck with `uploading` status. Reset them:

```javascript
// This requires direct database access - use Prisma Studio or a migration
// npx prisma studio
// Find images with status='uploading' and reset to status='pending'
```

## Testing Upload UI (Phase 5.5-5.6)

Once the UI is implemented, you can test uploads through the BrowseScans page:

1. Navigate to **Browse Scans**
2. Find a scan row and click the **Upload** button
3. Watch the progress indicator
4. Verify the status column updates to "Uploaded"

For batch uploads:

1. Select multiple scans using checkboxes
2. Click **Upload Selected**
3. Watch the batch progress indicator

## CI Testing

The upload IPC handlers are tested in CI without real credentials:

- Tests verify the handlers exist and return proper error structures
- Tests verify "Missing Bloom credentials" error when credentials aren't configured
- Tests verify "Scan not found" error for invalid scan IDs

Real upload tests require manual verification with valid credentials.

## Related Files

- `src/main/image-uploader.ts` - Upload service implementation
- `src/main/database-handlers.ts` - IPC handlers (`db:scans:upload`, `db:scans:uploadBatch`)
- `src/main/preload.ts` - Renderer API exposure
- `src/types/electron.d.ts` - TypeScript types
- `tests/unit/image-uploader.test.ts` - Unit tests (mocked)
- `tests/e2e/renderer-database-ipc.e2e.ts` - Integration tests (error paths)
