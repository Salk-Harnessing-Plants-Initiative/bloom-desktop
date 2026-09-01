import { useNavigate } from 'react-router-dom';

interface DailyWorkflowStep {
  id: string;
  title: string;
  description: string;
  route: string;
  icon: string;
  primary?: boolean;
}

const DAILY_STEPS: DailyWorkflowStep[] = [
  {
    id: 'camera-settings',
    title: 'Camera Settings',
    description: 'Confirm exposure and gain before you scan',
    route: '/camera-settings',
    icon: '📷',
  },
  {
    id: 'capture-scan',
    title: 'Capture Scan',
    description: 'Capture a 360-degree scan of a plant',
    route: '/capture-scan',
    icon: '🔄',
    primary: true,
  },
  {
    id: 'browse-scans',
    title: 'Browse Scans',
    description: 'Review and manage captured scans',
    route: '/browse-scans',
    icon: '📋',
  },
];

const SETUP_STEPS: DailyWorkflowStep[] = [
  {
    id: 'scientists',
    title: 'Scientists',
    description: 'Register the scientists running experiments',
    route: '/scientists',
    icon: '👥',
  },
  {
    id: 'phenotypers',
    title: 'Phenotypers',
    description: 'Add the people operating the scanner',
    route: '/phenotypers',
    icon: '🧑',
  },
  {
    id: 'accessions',
    title: 'Accessions',
    description: 'Define plant accessions and barcode mappings',
    route: '/accessions',
    icon: '📁',
  },
  {
    id: 'experiments',
    title: 'Experiments',
    description: 'Create experiments and attach accessions',
    route: '/experiments',
    icon: '🧪',
  },
];

/**
 * CylinderScan-only workflow guide. Restructures the prior flat numbered
 * list into a prominent Daily Workflow section (camera check, capture,
 * browse) and a less-prominent, unordered Setup section (#175) — a new
 * component rather than a change to a shared step-list component. See
 * GraviScanWorkflowGuide.tsx for GraviScan's equivalent (#328 piece 2).
 */
export function CylinderScanWorkflowGuide() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-gray-700">
          Daily Workflow
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {DAILY_STEPS.map((step) => (
            <button
              key={step.id}
              onClick={() => navigate(step.route)}
              data-testid={`workflow-step-${step.id}`}
              className={`flex items-start gap-4 p-4 rounded-lg text-left cursor-pointer border transition-all ${
                step.primary
                  ? 'bg-lime-700 border-lime-700 hover:bg-lime-800 shadow-md'
                  : 'bg-white border-gray-200 shadow hover:shadow-md hover:bg-lime-50'
              }`}
            >
              <div>
                <h3
                  className={`font-semibold ${step.primary ? 'text-white' : 'text-gray-800'}`}
                >
                  <span className="mr-2">{step.icon}</span>
                  {step.title}
                </h3>
                <p
                  className={`text-sm mt-1 ${step.primary ? 'text-lime-50' : 'text-gray-600'}`}
                >
                  {step.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium mb-4 text-gray-500">Setup</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {SETUP_STEPS.map((step) => (
            <button
              key={step.id}
              onClick={() => navigate(step.route)}
              data-testid={`workflow-step-${step.id}`}
              className="flex items-start gap-4 p-4 bg-white rounded-lg shadow hover:shadow-md hover:bg-lime-50 transition-all text-left cursor-pointer border border-gray-200"
            >
              <div>
                <h3 className="font-semibold text-gray-800">
                  <span className="mr-2">{step.icon}</span>
                  {step.title}
                </h3>
                <p className="text-sm text-gray-600 mt-1">{step.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
