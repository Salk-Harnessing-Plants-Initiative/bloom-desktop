## Why

ScanPreview cannot load images in development mode because webpack-dev-server serves the renderer from `http://localhost`, which cannot access `file://` URLs due to cross-origin security restrictions.

- **Production**: Works (renderer loaded via `file://`, same origin)
- **Development**: Broken (`http://localhost` cannot access `file://`)

## What Changes

- Add `webSecurity: false` to BrowserWindow webPreferences (matches pilot implementation)
- This allows `file://` URLs to load from HTTP context in development mode

### Pilot Reference

The pilot implementation uses the same approach:

- **app/src/main/main.ts:39**: `webSecurity: false, // TODO: remove this`
- Source: https://github.com/eberrigan/bloom-desktop-pilot

### Security Note

This is acceptable for a local desktop app used in a lab environment. A GitHub issue will be created to track the proper fix (custom protocol handler) for future improvement.

## Impact

- Affected specs: scan-preview (new spec)
- Affected code:
  - src/main/main.ts (webPreferences)
