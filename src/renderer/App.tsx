import 'tailwindcss/tailwind.css';
import './App.css';

import {
  MemoryRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Layout } from './Layout';
import { Home } from './Home';
import { CameraSettings } from './CameraSettings';
import { CaptureScan } from './CaptureScan';
import { Scientists } from './Scientists';
import { Phenotypers } from './Phenotypers';
import { Accessions } from './Accessions';
import { Experiments } from './Experiments';
import { BrowseScans } from './BrowseScans';
import { ScanPreview } from './ScanPreview';
import { MachineConfiguration } from './MachineConfiguration';
import { useAppMode } from './hooks/useAppMode';
import { ScannerConfig } from './graviscan/ScannerConfig';
import { Metadata } from './graviscan/Metadata';
import { GraviScan as GraviScanPage } from './graviscan/GraviScan';
import { BrowseGraviScans } from './graviscan/BrowseGraviScans';

export default function App() {
  const { mode, isLoading } = useAppMode();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  // First run (empty mode) — show only Machine Config, no sidebar/layout
  if (mode === '') {
    return (
      <Router initialEntries={['/machine-config']}>
        <Routes>
          <Route path="/machine-config" element={<MachineConfiguration />} />
          <Route path="*" element={<Navigate to="/machine-config" />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout mode={mode} />}>
          <Route index element={<Home mode={mode} />} />

          {/* Capture routes — conditional on scanner mode */}
          {mode === 'cylinderscan' && (
            <>
              <Route path="camera-settings" element={<CameraSettings />} />
              <Route path="capture-scan" element={<CaptureScan />} />
              <Route path="accessions" element={<Accessions />} />
            </>
          )}

          {/* GraviScan routes — conditional on graviscan mode */}
          {mode === 'graviscan' && (
            <>
              <Route path="scanner-config" element={<ScannerConfig />} />
              <Route path="metadata" element={<Metadata />} />
              <Route path="graviscan" element={<GraviScanPage />} />
            </>
          )}

          {/* Data entry routes — available for all modes */}
          <Route path="scientists" element={<Scientists />} />
          <Route path="phenotypers" element={<Phenotypers />} />
          <Route path="experiments" element={<Experiments />} />

          {/* Browse routes — always visible (data integrity across mode switches) */}
          <Route path="browse-scans" element={<BrowseScans />} />
          <Route path="browse-graviscan" element={<BrowseGraviScans />} />
          <Route path="scan/:scanId" element={<ScanPreview />} />

          {/* Config */}
          <Route path="machine-config" element={<MachineConfiguration />} />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </Router>
  );
}
