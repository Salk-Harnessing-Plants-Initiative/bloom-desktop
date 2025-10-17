/**
 * Python Status Component
 *
 * Displays the status of the Python backend and allows testing
 * of Python IPC communication.
 */

import { useEffect, useState } from 'react';

interface HardwareStatus {
  camera: {
    library_available: boolean;
    devices_found: number;
    available: boolean;
  };
  daq: {
    library_available: boolean;
    devices_found: number;
    available: boolean;
  };
}

export function PythonStatus() {
  const [version, setVersion] = useState<string>('');
  const [hardware, setHardware] = useState<HardwareStatus | null>(null);
  const [status, setStatus] = useState<string>('Checking...');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Get Python version
    window.electron.python
      .getVersion()
      .then((res) => {
        setVersion(res.version);
        setStatus('Connected');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('Error');
      });

    // Listen for Python status updates
    window.electron.python.onStatus((statusMsg) => {
      console.log('Python status:', statusMsg);
      setStatus(statusMsg);
    });

    // Listen for Python errors
    window.electron.python.onError((errorMsg) => {
      console.error('Python error:', errorMsg);
      setError(errorMsg);
      setStatus('Error');
    });
  }, []);

  const checkHardware = async () => {
    try {
      const result = await window.electron.python.checkHardware();
      setHardware(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restartPython = async () => {
    try {
      await window.electron.python.restart();
      setStatus('Restarted');
      setError('');
      // Re-fetch version after restart
      const res = await window.electron.python.getVersion();
      setVersion(res.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
              status === 'Connected' || status.includes('ready')
                ? 'bg-green-100 text-green-800'
                : status === 'Error'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {status}
          </span>
        </div>

        {/* Version */}
        {version && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Version:</span>
            <span className="text-gray-700">{version}</span>
          </div>
        )}

        {/* Hardware status */}
        {hardware && (
          <div className="space-y-2">
            <div className="font-medium">Hardware:</div>
            <div className="ml-4 space-y-1 text-sm">
              {/* Camera status */}
              <div className="flex items-center gap-2">
                <span className="font-medium">Camera:</span>
                {hardware.camera.available ? (
                  <span className="text-green-600 font-semibold">
                    [OK] {hardware.camera.devices_found} device(s) found
                  </span>
                ) : hardware.camera.library_available ? (
                  <span className="text-yellow-600">
                    [WARN] Library installed, no devices found
                  </span>
                ) : (
                  <span className="text-red-600">[ERROR] Library not installed</span>
                )}
              </div>
              {/* DAQ status */}
              <div className="flex items-center gap-2">
                <span className="font-medium">DAQ:</span>
                {hardware.daq.available ? (
                  <span className="text-green-600 font-semibold">
                    [OK] {hardware.daq.devices_found} device(s) found
                  </span>
                ) : hardware.daq.library_available ? (
                  <span className="text-yellow-600">
                    [WARN] Library installed, no devices found
                  </span>
                ) : (
                  <span className="text-red-600">[ERROR] Library not installed</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={checkHardware}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Check Hardware
          </button>
          <button
            onClick={restartPython}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition"
          >
            Restart Python
          </button>
        </div>
      </div>
    </div>
  );
}
