# React Components

This directory contains reusable React components for the Bloom Desktop UI.

## Structure (Phase 4+)

Future components will be organized by feature:

```
components/
├── camera/
│   ├── CameraControl.tsx     # Camera connection and settings
│   ├── CameraPreview.tsx     # Live camera feed
│   └── CameraSettings.tsx    # Camera configuration UI
├── daq/
│   ├── DaqControl.tsx         # DAQ connection and control
│   ├── RotationControl.tsx    # Manual rotation controls
│   └── DaqStatus.tsx          # DAQ status display
├── scanning/
│   ├── ScanSetup.tsx          # Scan configuration
│   ├── ScanProgress.tsx       # Scan progress indicator
│   └── ScanResults.tsx        # Scan results display
└── common/
    ├── Button.tsx             # Reusable button component
    ├── StatusIndicator.tsx    # Status LED indicator
    └── ErrorMessage.tsx       # Error display component
```

## Component Guidelines

### Naming Convention

- Use PascalCase for component files: `CameraControl.tsx`
- Match file name to component name

### Structure

```tsx
// Good component structure
import React from 'react';

interface ComponentProps {
  // Props interface
}

export const ComponentName: React.FC<ComponentProps> = ({ prop1, prop2 }) => {
  // Component logic
  return <div>...</div>;
};
```

### Using window.electron API

```tsx
import { useEffect, useState } from 'react';

export const CameraControl: React.FC = () => {
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    // Call Python backend
    window.electron.python.checkHardware().then((result) => {
      setStatus(result.camera ? 'Connected' : 'Disconnected');
    });
  }, []);

  return <div>Camera: {status}</div>;
};
```

## Testing

Component tests will go in `tests/unit/components/`
