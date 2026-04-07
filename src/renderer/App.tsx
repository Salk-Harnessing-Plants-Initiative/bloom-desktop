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

export default function App() {
  const { mode, isLoading } = useAppMode();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  // First run (empty mode) — redirect to machine config
  const initialRoute = mode === '' ? '/machine-config' : '/';

  return (
    <Router initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/" element={<Layout mode={mode} />}>
          <Route index element={<Home />} />

          {/* Capture routes — conditional on scanner mode */}
          {(mode === 'cylinderscan' || mode === 'full') && (
            <>
              <Route path="camera-settings" element={<CameraSettings />} />
              <Route path="capture-scan" element={<CaptureScan />} />
              <Route path="accessions" element={<Accessions />} />
            </>
          )}

          {/* Data entry routes — available for all modes */}
          <Route path="scientists" element={<Scientists />} />
          <Route path="phenotypers" element={<Phenotypers />} />
          <Route path="experiments" element={<Experiments />} />

          {/* Browse routes — always visible */}
          <Route path="browse-scans" element={<BrowseScans />} />
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
