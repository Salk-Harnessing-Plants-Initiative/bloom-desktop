## ADDED Requirements

### Requirement: Deterministic Streaming Bitmap Lifecycle

The Streamer component SHALL render camera preview frames using a `<canvas>` element with `createImageBitmap()` decoding and explicit `bitmap.close()` to deterministically free decoded C++ bitmap memory. The rendering pipeline SHALL NOT use `fetch()`, `URL.createObjectURL()`, `URL.revokeObjectURL()`, or `Image` objects, as these create C++ allocations that Chromium does not reliably free (confirmed by diagnostic: IPC-only test survived 20+ min, rendering test OOMed at 15 min).

#### Scenario: Frame decoded via createImageBitmap and drawn to canvas

- **GIVEN** a JPEG frame arrives as a base64 data URI from IPC
- **WHEN** the Streamer processes the frame
- **THEN** the base64 data SHALL be decoded to a `Uint8Array` via `atob()`
- **AND** a `Blob` SHALL be created from the binary data
- **AND** `createImageBitmap(blob)` SHALL be called to decode the image
- **AND** the bitmap SHALL be drawn to the canvas via `ctx.drawImage(bitmap, ...)`
- **AND** `bitmap.close()` SHALL be called immediately after drawing to free C++ memory

#### Scenario: Canvas preserves aspect ratio with letterboxing

- **GIVEN** the camera frame is 2048×1080 (~1.9:1 aspect ratio)
- **AND** the canvas display area is 800×600 (~1.33:1)
- **WHEN** the frame is drawn to the canvas
- **THEN** the frame SHALL be scaled to fit within the canvas using `bitmap.width` and `bitmap.height` for the source dimensions
- **AND** the canvas SHALL be cleared before drawing (CSS background provides black letterbox bars)
- **AND** the frame SHALL NOT be stretched or distorted

#### Scenario: Renderer-side busy gate prevents concurrent decodes

- **GIVEN** a frame is currently being decoded (`createImageBitmap` pending)
- **WHEN** a new frame arrives from IPC
- **THEN** the new frame's data URI SHALL be stored as a pending frame (latest-frame-wins, overwriting any previous pending)
- **AND** when the current decode completes, only the most recent pending frame SHALL be decoded next

#### Scenario: bitmap.close() called after every drawImage

- **GIVEN** a frame was decoded and drawn to canvas
- **WHEN** the draw operation completes
- **THEN** `bitmap.close()` SHALL be called in the same execution path
- **AND** no decoded bitmap SHALL remain in memory after drawing

#### Scenario: bitmap.close() called even after unmount

- **GIVEN** a frame is being decoded (`createImageBitmap` pending)
- **AND** the component unmounts before the decode resolves
- **WHEN** `createImageBitmap` resolves with a bitmap
- **THEN** `bitmap.close()` SHALL still be called to free C++ memory
- **AND** `drawImage` SHALL NOT be called (canvas may no longer be in DOM)

#### Scenario: Decode failure does not jam the busy gate

- **GIVEN** `createImageBitmap()` rejects (e.g., corrupt JPEG data)
- **WHEN** the rejection handler runs
- **THEN** the busy gate SHALL be cleared (`isDecoding = false`)
- **AND** if a pending frame exists, it SHALL be decoded next
- **AND** the stream SHALL NOT be permanently stalled

#### Scenario: Invalid base64 does not crash the component

- **GIVEN** a frame arrives with invalid base64 data (not valid base64 encoding)
- **WHEN** `atob()` throws synchronously
- **THEN** the error SHALL be caught
- **AND** the busy gate SHALL be cleared
- **AND** if a pending frame exists, it SHALL be decoded next

#### Scenario: Clean resource release on unmount

- **GIVEN** the Streamer component is mounted and streaming
- **WHEN** the component unmounts
- **THEN** `mountedRef.current` SHALL be set to `false` first
- **AND** the pending frame buffer SHALL be cleared
- **AND** the frame listener SHALL be removed
- **AND** the stream SHALL be stopped

#### Scenario: Pre-first-frame connecting state preserved

- **GIVEN** the Streamer has mounted but no frame has been drawn yet
- **WHEN** the component renders
- **THEN** "Connecting..." text SHALL be displayed
- **AND** the canvas SHALL be hidden (display:none) until the first frame is drawn
- **AND** once the first frame draws, the placeholder SHALL be hidden and the canvas shown
