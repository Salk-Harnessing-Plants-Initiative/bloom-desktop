import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PythonStatus } from './components/PythonStatus';

type WorkflowStep = {
  step: number;
  title: string;
  description: string;
  route: string;
  icon: string;
};

const graviscanSteps: WorkflowStep[] = [
  {
    step: 1,
    title: 'Scientists',
    description: 'Register lab scientists who own experiments.',
    route: '/scientists',
    icon: '\u{1F9D1}\u200D\u{1F52C}',
  },
  {
    step: 2,
    title: 'Phenotypers',
    description: 'Register users who perform scans.',
    route: '/phenotypers',
    icon: '\u{1F464}',
  },
  {
    step: 3,
    title: 'Metadata',
    description: 'Upload plate accession CSV files.',
    route: '/metadata',
    icon: '\u{1F4C2}',
  },
  {
    step: 4,
    title: 'Experiments',
    description: 'Create experiment with scientist and accessions.',
    route: '/experiments',
    icon: '\u{1F9EA}',
  },
  {
    step: 5,
    title: 'Scanning',
    description: 'Configure scanner, assign plates, run scans.',
    route: '/scanning',
    icon: '\u{1F5A8}\uFE0F',
  },
  {
    step: 6,
    title: 'Browse Scans',
    description: 'Review scans and upload to Bloom.',
    route: '/browse-scans',
    icon: '\u{1F5BC}\uFE0F',
  },
];

type HomeTab = 'graviscan' | 'cylinderscan';

export function Home() {
  const navigate = useNavigate();
  const [isCheckingConfig, setIsCheckingConfig] = useState(true);
  const [activeTab, setActiveTab] = useState<HomeTab>(
    APP_MODE === 'cylinderscan' ? 'cylinderscan' : 'graviscan'
  );

  // Check if this is first run (no config exists)
  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const configExists = await window.electron.config.exists();
        if (!configExists) {
          // First run - redirect to machine configuration
          navigate('/machine-config');
        }
      } catch (error) {
        console.error('Failed to check config:', error);
      } finally {
        setIsCheckingConfig(false);
      }
    };
    checkFirstRun();
  }, [navigate]);

  // Show loading while checking config
  if (isCheckingConfig) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const showBothTabs = APP_MODE === 'full';

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1 text-gray-800">Bloom Desktop</h1>
      <p className="text-gray-500 mb-6">
        Plant phenotyping scanning application.
      </p>

      {/* Tabs — only shown in full mode */}
      {showBothTabs && (
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('graviscan')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'graviscan'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              GraviScan
            </button>
            <button
              onClick={() => setActiveTab('cylinderscan')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'cylinderscan'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Cylinder Scan
            </button>
          </nav>
        </div>
      )}

      {/* GraviScan tab content */}
      {activeTab === 'graviscan' && (
        <div>
          <p className="text-gray-600 text-sm mb-5">
            Follow these steps to set up and run flatbed scans.
          </p>

          <div className="space-y-2">
            {graviscanSteps.map((step) => (
              <button
                key={step.step}
                onClick={() => navigate(step.route)}
                className="w-full flex items-center gap-4 px-4 py-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left group"
              >
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  {step.step}
                </span>
                <span className="text-xl flex-shrink-0">{step.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-800 group-hover:text-blue-700">{step.title}</span>
                  <span className="text-gray-400 mx-2">&mdash;</span>
                  <span className="text-gray-500 text-sm">{step.description}</span>
                </div>
                <span className="text-gray-300 group-hover:text-blue-500 transition-colors">&rarr;</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cylinder Scan tab content */}
      {activeTab === 'cylinderscan' && (
        <div>
          <div className="p-6 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="text-lg font-semibold mb-2 text-blue-900">
              Under Construction
            </h3>
            <p className="text-blue-800">
              This application is being migrated from the pilot repository. Hardware
              integration and additional features coming soon!
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                <li>[OK] IPC Communication</li>
                <li>[TODO] Hardware integration</li>
                <li>[TODO] Database setup</li>
              </ul>
            </div>
          </div>

          <div className="mt-6">
            <PythonStatus />
          </div>
        </div>
      )}
    </div>
  );
}
