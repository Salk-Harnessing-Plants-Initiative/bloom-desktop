import { useState } from 'react';
import { BrowseGraviScans } from './BrowseGraviScans';
import { BrowseCylinderScans } from './BrowseCylinderScans';

type TabType = 'cylinder' | 'graviscan';

export function BrowseScans() {
  const [activeTab, setActiveTab] = useState<TabType>(
    APP_MODE === 'cylinderscan' ? 'cylinder' : 'graviscan'
  );

  // Single-mode: render directly without tabs
  if (APP_MODE === 'graviscan') return <BrowseGraviScans />;
  if (APP_MODE === 'cylinderscan') return <BrowseCylinderScans />;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header + Tabs */}
      <div className="px-6 pt-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Browse Scans</h1>
          <p className="text-gray-600 mt-1">
            View and manage scanned images
          </p>
        </div>

        <div className="border-b border-gray-200 mt-6">
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
      </div>

      {/* Tab Content */}
      {activeTab === 'cylinder' && <BrowseCylinderScans />}
      {activeTab === 'graviscan' && <BrowseGraviScans />}
    </div>
  );
}
