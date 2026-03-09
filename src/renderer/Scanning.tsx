/**
 * Scanning Page
 *
 * Tabbed container for CylinderScan and GraviScan functionality.
 */

import { useState } from 'react';
import { CylinderScan } from './CylinderScan';
import { GraviScan } from './GraviScan';

type TabType = 'cylinder' | 'graviscan';

export function Scanning() {
  const [activeTab, setActiveTab] = useState<TabType>(
    APP_MODE === 'graviscan' ? 'graviscan' : 'cylinder'
  );

  // Single-mode: render directly without tabs
  if (APP_MODE === 'graviscan') return <GraviScan />;
  if (APP_MODE === 'cylinderscan') return <CylinderScan />;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scanning</h1>
          <p className="text-gray-600 mt-1">
            Capture plant scans using cylinder scanner or GraviScan
          </p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('cylinder')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'cylinder'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              CylinderScan
            </button>
            <button
              onClick={() => setActiveTab('graviscan')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'graviscan'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              GraviScan
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'cylinder' && <CylinderScan />}
          {activeTab === 'graviscan' && <GraviScan />}
        </div>
      </div>
    </div>
  );
}
