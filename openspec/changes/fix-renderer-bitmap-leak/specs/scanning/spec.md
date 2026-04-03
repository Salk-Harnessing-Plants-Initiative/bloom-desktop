## ADDED Requirements

### Requirement: Deterministic Streaming Bitmap Lifecycle

The Streamer component SHALL render camera preview frames using a `<canvas>` element with Blob URL decoding and explicit revocation to prevent Chromium's data-URI bitmap cache from accumulating decoded images. This bypasses Chromium issue 41067124 (data URI img src memory leak).

#### Scenario: Frame rendered via canvas with Blob URL

- **GIVEN** a JPEG frame arrives as a base64 data URI from IPC
- **WHEN** the Streamer processes the frame
- **THEN** the base64 data SHALL be decoded to binary
- **AND** a `Blob` SHALL be created from the binary data
- **AND** a Blob URL SHALL be created via `URL.createObjectURL()`
- **AND** the frame SHALL be drawn to the canvas via `drawImage()` with aspect-ratio-preserving scaling
- **AND** the Blob URL SHALL be revoked via `URL.revokeObjectURL()` immediately after `drawImage()` completes

#### Scenario: Canvas preserves aspect ratio with letterboxing

- **GIVEN** the camera frame is 2048×1080 (~1.9:1 aspect ratio)
- **AND** the canvas display area is 800×600 (~1.33:1)
- **WHEN** the frame is drawn to the canvas
- **THEN** the frame SHALL be scaled to fit within the canvas while preserving its native aspect ratio
- **AND** the canvas SHALL be cleared to black before drawing (letterbox bars)
- **AND** the frame SHALL NOT be stretched or distorted

#### Scenario: Single Image object reused for decoding

- **GIVEN** the Streamer is mounted and streaming
- **WHEN** multiple frames arrive over time
- **THEN** a single `Image` object SHALL be reused for all frame decoding
- **AND** `new Image()` SHALL NOT be called for each frame

#### Scenario: Renderer-side busy gate prevents concurrent decodes

- **GIVEN** a frame is currently being decoded (Image.onload pending)
- **WHEN** a new frame arrives from IPC
- **THEN** the new frame's data URI SHALL be stored as a pending frame (latest-frame-wins, overwriting any previous pending)
- **AND** when the current decode completes, only the most recent pending frame SHALL be decoded next

#### Scenario: Previous Blob URL revoked immediately after drawing

- **GIVEN** a frame was decoded and `drawImage()` completed
- **WHEN** the `onload` handler finishes
- **THEN** the Blob URL used for this frame SHALL be revoked via `URL.revokeObjectURL()` in the same handler
- **AND** at most 1 Blob URL SHALL be active at any point during streaming

#### Scenario: Decode failure does not jam the busy gate

- **GIVEN** a frame's `Image.onerror` fires (e.g., corrupt JPEG data)
- **WHEN** the error handler runs
- **THEN** the busy gate SHALL be cleared (`isDecoding = false`)
- **AND** the current Blob URL SHALL be revoked
- **AND** if a pending frame exists, it SHALL be decoded next
- **AND** the stream SHALL NOT be permanently stalled

#### Scenario: onload/onerror handlers are no-ops after unmount

- **GIVEN** the Streamer is streaming and a frame is being decoded
- **WHEN** the component unmounts before `onload`/`onerror` fires
- **THEN** the `mountedRef` SHALL be set to `false` in the cleanup function
- **AND** the onload/onerror handlers SHALL check `mountedRef` and return early if unmounted
- **AND** no canvas operations or state updates SHALL occur after unmount

#### Scenario: Clean resource release on unmount

- **GIVEN** the Streamer component is mounted and streaming
- **WHEN** the component unmounts (navigation away, scan starts)
- **THEN** `mountedRef.current` SHALL be set to `false` first
- **AND** the pending frame buffer SHALL be cleared
- **AND** the Image object's src SHALL be set to empty string (abort pending decode)
- **AND** the current Blob URL (if any) SHALL be revoked
- **AND** the frame listener SHALL be removed
- **AND** the stream SHALL be stopped

#### Scenario: Pre-first-frame connecting state preserved

- **GIVEN** the Streamer has mounted but no frame has been drawn yet
- **WHEN** the component renders
- **THEN** "Connecting..." text SHALL be displayed (same as current behavior)
- **AND** the canvas SHALL be hidden or replaced by the placeholder
- **AND** once the first frame is drawn, the placeholder SHALL be replaced by the canvas

#### Scenario: At most one active Blob URL during streaming

- **GIVEN** the Streamer is streaming at 5 FPS
- **WHEN** `URL.revokeObjectURL()` is called after each `drawImage()`
- **THEN** at most 1 Blob URL SHALL exist at any point in time
- **AND** `URL.createObjectURL` call count SHALL equal `URL.revokeObjectURL` call count (within ±1 for the in-flight frame)
