# Electron Packaging & Distribution

Guide for creating distributable packages and installers with Electron Forge.

## Commands

### Create Distributable Package

```bash
# Build Python executable and create distributable
npm run package

# Output locations:
# - macOS: out/Bloom Desktop-darwin-arm64/ or out/Bloom Desktop-darwin-x64/
# - Linux: out/Bloom Desktop-linux-x64/
# - Windows: out/Bloom Desktop-win32-x64/
```

### Create Platform Installers

```bash
# Create platform-specific installers
npm run make

# Output locations (in out/make/):
# - macOS: .dmg file
# - Linux: .deb, .rpm, AppImage
# - Windows: Squirrel installer
```

## Packaging Checklist

Before packaging, ensure:

- [ ] Python executable built (`npm run build:python`)
- [ ] All tests passing (`npm run test:unit`, `npm run test:python`)
- [ ] Integration tests passing (`npm run test:camera`, `npm run test:scanner`)
- [ ] E2E tests passing (`npm run test:e2e`)
- [ ] Linting passing (`npm run lint`, `npm run format:check`)
- [ ] Database migrations tested
- [ ] Version number updated in `package.json`

## Packaging Configuration

**Location**: `forge.config.ts`

Key configurations:

### Extra Resources

```typescript
packagerConfig: {
  extraResource: [
    './dist/bloom-hardware',  // Python executable
    './prisma',               // Database schema and migrations
  ],
}
```

### ASAR Configuration

```typescript
packagerConfig: {
  asar: {
    unpack: '{**/node_modules/@prisma/engines/**/*,**/prisma/**/*}',
  },
}
```

**Why unpack Prisma**:

- Prisma binary engines cannot run from inside ASAR archive
- Must be extracted to filesystem
- See `docs/PACKAGING.md` for details

### Platform-Specific Configuration

```typescript
// macOS
osxSign: {
  identity: 'Developer ID Application: ...',
},
osxNotarize: {
  tool: 'notarytool',
  appleId: process.env.APPLE_ID,
  appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
  teamId: process.env.APPLE_TEAM_ID,
},

// Windows
makers: [{
  name: '@electron-forge/maker-squirrel',
  config: {
    name: 'bloom_desktop',
  },
}],
```

## Platform-Specific Packaging

### macOS

#### Code Signing

```bash
# Sign the app (requires Developer ID certificate)
npm run package

# Or manually sign
codesign --sign "Developer ID Application: ..." --deep --force \
  "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"
```

#### Notarization

```bash
# Notarize for Gatekeeper (requires Apple Developer account)
npm run make  # Automatically notarizes if credentials set

# Set environment variables:
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

#### Universal Binary

To support both Intel and Apple Silicon:

```typescript
// forge.config.ts
packagerConfig: {
  arch: 'universal',  // Builds for both x64 and arm64
}
```

### Windows

#### Squirrel Installer

```bash
npm run make

# Creates Setup.exe installer
# Users run Setup.exe, which installs app to AppData\Local\
```

#### Code Signing (Optional)

```typescript
// forge.config.ts
makers: [{
  name: '@electron-forge/maker-squirrel',
  config: {
    certificateFile: './cert.pfx',
    certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
  },
}],
```

### Linux

#### Multiple Formats

```bash
npm run make

# Creates:
# - .deb (Debian/Ubuntu)
# - .rpm (Fedora/RHEL)
# - AppImage (universal)
```

## Testing Packaged App

### Manual Testing

```bash
# After npm run package

# macOS
open "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"

# Linux
./out/Bloom\ Desktop-linux-x64/Bloom\ Desktop

# Windows
.\out\Bloom Desktop-win32-x64\Bloom Desktop.exe
```

### Automated Testing

```bash
# Test database initialization in packaged app
npm run test:package:database
```

## Common Issues

### "Prisma Client not found" in Packaged App

**Cause**: Prisma engines not extracted from ASAR

**Solution**: Verify `asar.unpack` in `forge.config.ts` includes Prisma:

```typescript
asar: {
  unpack: '{**/node_modules/@prisma/engines/**/*,**/prisma/**/*}',
}
```

### Python Executable "Permission denied" on macOS/Linux

**Cause**: Executable bit not set after packaging

**Solution**: Set permissions in packaging script:

```typescript
// In hooks/postPackage.ts
import { chmod } from 'fs/promises';

export default async function postPackage() {
  await chmod('out/.../bloom-hardware', 0o755);
}
```

### "App is damaged and can't be opened" on macOS

**Cause**: macOS Gatekeeper - app not signed or notarized

**Solutions**:

1. **Sign and notarize** (production): See code signing section above
2. **Developer bypass** (local testing only):
   ```bash
   xattr -cr "out/Bloom Desktop-darwin-arm64/Bloom Desktop.app"
   ```

### Database Not Creating in Production

**Cause**: Database path incorrect or permissions issue

**Debug**:

1. Check environment variable: `BLOOM_DATABASE_URL`
2. Verify user data directory exists: `~/.bloom/data/`
3. Check write permissions
4. Look at app logs (stdout/stderr)

### Resource Files Not Found

**Cause**: Resource paths wrong in packaged app vs. development

**Solution**: Use proper path resolution:

```typescript
// src/main/python-paths.ts
import { app } from 'electron';
import path from 'path';

const getResourcePath = (filename: string) => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, filename);
  }
  return path.join(__dirname, '..', '..', filename);
};
```

## Distribution

### Release Workflow

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Run full test suite
4. Create packages: `npm run make`
5. Test packages on each platform
6. Create GitHub release
7. Upload installers as release assets

### GitHub Releases

```bash
# Create release with gh CLI
gh release create v0.2.0 \
  --title "Bloom Desktop v0.2.0" \
  --notes-file RELEASE_NOTES.md \
  out/make/**/*.dmg \
  out/make/**/*.deb \
  out/make/**/*.exe
```

### Auto-Update (Future)

Electron Forge supports auto-update via Electron's `autoUpdater`:

```typescript
// Future implementation
import { autoUpdater } from 'electron-updater';

autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'Salk-Harnessing-Plants-Initiative',
  repo: 'bloom-desktop',
});
```

## Build Size Optimization

### Current Package Sizes (Approximate)

- **macOS**: ~200-300 MB
- **Windows**: ~150-250 MB
- **Linux**: ~150-250 MB

### Optimization Tips

1. **Exclude dev dependencies**: Already done (not packaged)
2. **Minimize Python dependencies**: Remove unused packages
3. **Optimize Electron**: Use `electronPackagerConfig.prune: true`
4. **Compress installers**: DMG, Squirrel already compress

## Troubleshooting Build Issues

### Build Fails on macOS

Check:

- Xcode Command Line Tools installed
- Developer certificate in Keychain
- Notarization credentials set

### Build Fails on Windows

Check:

- Node-gyp dependencies installed
- Visual Studio Build Tools installed
- Python available (for node-gyp)

### Build Fails on Linux

Check:

- Required packages installed: `dpkg`, `fakeroot`, `rpm`
- AppImage dependencies: `fuse`

## Related Commands

- `/python-bundling` - Building Python executable (prerequisite)
- `/database-migration` - Database handling in packaged apps
- `/integration-testing` - Testing packaged app functionality

## Documentation

- **Packaging Guide**: `docs/PACKAGING.md`
- **Electron Forge**: https://www.electronforge.io/
- **Electron Builder**: https://www.electron.build/ (alternative)