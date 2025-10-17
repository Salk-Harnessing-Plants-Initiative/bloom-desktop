import React from 'react';

export function Home() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4 text-gray-800">Bloom Desktop</h1>
      <p className="text-gray-600 mb-8">
        Electron-React application for cylinder scanning.
      </p>

      <div className="mt-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
        <h2 className="text-xl font-semibold mb-2 text-blue-900">
          Under Construction
        </h2>
        <p className="text-blue-800">
          This application is being migrated from the pilot repository. Hardware
          integration and additional features coming soon!
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-800">
            Architecture
          </h3>
          <ul className="text-gray-600 space-y-2">
            <li>Frontend: Electron + React + TypeScript</li>
            <li>Backend: Python (Basler Pylon + NI-DAQ)</li>
            <li>Build: Electron Forge + Webpack</li>
            <li>Styling: TailwindCSS</li>
          </ul>
        </div>

        <div className="p-6 bg-white rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-2 text-gray-800">Status</h3>
          <ul className="text-gray-600 space-y-2">
            <li>[OK] Application shell</li>
            <li>[OK] Navigation</li>
            <li>[TODO] Hardware integration</li>
            <li>[TODO] Database setup</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
