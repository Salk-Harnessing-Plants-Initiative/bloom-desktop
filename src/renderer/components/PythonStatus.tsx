/**
 * Python Status Component
 *
 * Displays a simple connected/checking/error status indicator for the
 * Python backend on the Home page. Interactive troubleshooting controls
 * (Check Hardware, Restart Python) live in Machine Configuration instead
 * (see MachineConfiguration.tsx's Hardware Diagnostics section, #339) —
 * this component never invokes python:check-hardware or python:restart.
 */

import { useEffect, useState } from 'react';

interface PythonStatusProps {
  mode?: string | null;
}

export function PythonStatus({ mode = null }: PythonStatusProps) {
  const [version, setVersion] = useState<string>('');
  const [status, setStatus] = useState<string>('Checking...');

  useEffect(() => {
    // Python connectivity is only relevant in CylinderScan mode — this
    // component renders nothing at all in graviscan mode (see the
    // render-level guard below), so skip the IPC calls/subscriptions
    // entirely too. This check must live inside the effect, not just at
    // the render level: React's Rules of Hooks require every hook to run
    // on every render regardless of where a render-level early return
    // sits, so a render-only gate would still fire this effect (and its
    // IPC round-trips) in graviscan mode even though nothing is ever shown.
    if (mode !== 'cylinderscan') return;

    // Get Python version
    window.electron.python
      .getVersion()
      .then((res) => {
        setVersion(res.version);
        setStatus('Connected');
      })
      .catch(() => {
        setStatus('Error');
      });

    // Listen for Python status updates
    const cleanupStatus = window.electron.python.onStatus((statusMsg) => {
      console.log('Python status:', statusMsg);
      setStatus(statusMsg);
    });

    // Listen for Python errors
    const cleanupError = window.electron.python.onError((errorMsg) => {
      console.error('Python error:', errorMsg);
      setStatus('Error');
    });

    return () => {
      cleanupStatus();
      cleanupError();
    };
  }, [mode]);

  if (mode !== 'cylinderscan') {
    return null;
  }

  // Relabeling of the three states this component already distinguished
  // for its colored pill — not a new state machine. "Checking" covers the
  // initial mount state and any other status string that isn't a clear
  // Connected/Error signal. `main.ts` sends "Process exited: <code>" as a
  // `python:status` push (not `python:error`) when the subprocess dies —
  // that must count as Error, not fall through to the calm "Checking"
  // bucket, or a real crash would show no error color and no admin-contact
  // message at all.
  const isConnected = status === 'Connected' || status.includes('ready');
  const isError = status === 'Error' || status.startsWith('Process exited');

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">
        Python Backend Status
      </h3>

      <div className="space-y-3">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span className="font-medium">Status:</span>
          <span
            className={`px-2 py-1 rounded text-sm ${
              isConnected
                ? 'bg-green-100 text-green-800'
                : isError
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {isConnected ? 'Connected' : isError ? 'Error' : 'Checking'}
          </span>
        </div>

        {/* Version */}
        {version && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Version:</span>
            <span className="text-gray-700">{version}</span>
          </div>
        )}

        {/* Generic admin-contact message on failure — the detailed
            camera/DAQ breakdown now lives only in Machine Configuration's
            "Check Hardware", which this component never invokes. */}
        {isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-sm text-red-800">
              Contact your administrator. Admins: press Ctrl+Shift+,
              (Cmd+Shift+, on Mac) for hardware diagnostics.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
