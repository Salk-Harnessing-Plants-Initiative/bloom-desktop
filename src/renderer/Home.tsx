import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PythonStatus } from './components/PythonStatus';
import {
  WorkflowSteps,
  cylinderScanSteps,
  graviScanSteps,
} from './components/WorkflowSteps';

interface HomeProps {
  mode?: string | null;
}

export function Home({ mode = null }: HomeProps) {
  const navigate = useNavigate();
  const [isCheckingConfig, setIsCheckingConfig] = useState(true);

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

  const steps = mode === 'graviscan' ? graviScanSteps : cylinderScanSteps;
  const modeLabel = mode === 'graviscan' ? 'GraviScan' : 'CylinderScan';

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2 text-gray-800">Bloom Desktop</h1>
      <p className="text-gray-600 mb-8">
        {modeLabel} workflow — follow these steps to capture and manage scans.
      </p>

      <h2 className="text-xl font-semibold mb-4 text-gray-700">
        Workflow Steps
      </h2>
      <WorkflowSteps steps={steps} />

      {/* Python Backend Status */}
      <div className="mt-8">
        <PythonStatus />
      </div>
    </div>
  );
}
