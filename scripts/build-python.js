const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building Python executable...');

// Ensure uv is available
try {
  execSync('uv --version', { stdio: 'inherit' });
} catch (error) {
  console.error('[ERROR] uv is not installed.');
  console.error(
    'Install it from: https://docs.astral.sh/uv/getting-started/installation/'
  );
  process.exit(1);
}

// Ensure pyproject.toml exists
const pyprojectPath = path.join(__dirname, '..', 'pyproject.toml');
if (!fs.existsSync(pyprojectPath)) {
  console.error('[ERROR] pyproject.toml not found');
  process.exit(1);
}

// Sync dependencies first (including dev dependencies for PyInstaller)
console.log('[INFO] Installing dependencies...');
try {
  execSync('uv sync --extra dev', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
} catch (error) {
  console.error('[ERROR] Failed to sync dependencies');
  process.exit(1);
}

// Clean PyInstaller build cache to ensure fresh build
// This is critical when hiddenimports are modified in main.spec
const buildDir = path.join(__dirname, '..', 'build');
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(buildDir)) {
  console.log('[INFO] Cleaning PyInstaller build cache...');
  fs.rmSync(buildDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
if (fs.existsSync(distDir)) {
  console.log('[INFO] Cleaning dist directory...');
  fs.rmSync(distDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

// Run PyInstaller
console.log('[INFO] Running PyInstaller...');
try {
  execSync('uv run pyinstaller python/main.spec', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  console.log('[SUCCESS] Python executable built successfully!');
  console.log('[INFO] Output: dist/');
} catch (error) {
  console.error('[ERROR] Failed to build Python executable');
  process.exit(1);
}
