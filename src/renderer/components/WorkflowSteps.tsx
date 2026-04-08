import { useNavigate } from 'react-router-dom';

export interface WorkflowStep {
  step: number;
  title: string;
  description: string;
  route: string;
  icon: string;
}

export const cylinderScanSteps: WorkflowStep[] = [
  {
    step: 1,
    title: 'Scientists',
    description: 'Register the scientists running experiments',
    route: '/scientists',
    icon: '👥',
  },
  {
    step: 2,
    title: 'Phenotypers',
    description: 'Add the people operating the scanner',
    route: '/phenotypers',
    icon: '🧑',
  },
  {
    step: 3,
    title: 'Accessions',
    description: 'Define plant accessions and barcode mappings',
    route: '/accessions',
    icon: '📁',
  },
  {
    step: 4,
    title: 'Experiments',
    description: 'Create experiments and attach accessions',
    route: '/experiments',
    icon: '🧪',
  },
  {
    step: 5,
    title: 'Camera Settings',
    description: 'Configure camera exposure and white balance',
    route: '/camera-settings',
    icon: '📷',
  },
  {
    step: 6,
    title: 'Capture Scan',
    description: 'Capture a 360-degree scan of a plant',
    route: '/capture-scan',
    icon: '🔄',
  },
  {
    step: 7,
    title: 'Browse Scans',
    description: 'Review and manage captured scans',
    route: '/browse-scans',
    icon: '📋',
  },
];

export const graviScanSteps: WorkflowStep[] = [
  {
    step: 1,
    title: 'Scientists',
    description: 'Register the scientists running experiments',
    route: '/scientists',
    icon: '👥',
  },
  {
    step: 2,
    title: 'Phenotypers',
    description: 'Add the people operating the scanner',
    route: '/phenotypers',
    icon: '🧑',
  },
  {
    step: 3,
    title: 'Metadata',
    description: 'Configure experiment metadata fields',
    route: '/experiments',
    icon: '📝',
  },
  {
    step: 4,
    title: 'Experiments',
    description: 'Create experiments for gravitropism studies',
    route: '/experiments',
    icon: '🧪',
  },
  {
    step: 5,
    title: 'Capture Scan',
    description: 'Capture a time-lapse gravitropism scan',
    route: '/capture-scan',
    icon: '🔄',
  },
  {
    step: 6,
    title: 'Browse Scans',
    description: 'Review and manage captured scans',
    route: '/browse-scans',
    icon: '📋',
  },
];

interface WorkflowStepsProps {
  steps: WorkflowStep[];
}

export function WorkflowSteps({ steps }: WorkflowStepsProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {steps.map((ws) => (
        <button
          key={ws.step}
          onClick={() => navigate(ws.route)}
          className="flex items-start gap-4 p-4 bg-white rounded-lg shadow hover:shadow-md hover:bg-blue-50 transition-all text-left cursor-pointer border border-gray-200"
          data-testid={`workflow-step-${ws.step}`}
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
            {ws.step}
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">
              <span className="mr-2">{ws.icon}</span>
              {ws.title}
            </h3>
            <p className="text-sm text-gray-600 mt-1">{ws.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
