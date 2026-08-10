import 'tailwindcss/tailwind.css';
import './App.css';

import { lazy, Suspense } from 'react';
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
import { Export } from './Export';
import { ScanPreview } from './ScanPreview';
import { MachineConfiguration } from './MachineConfiguration';
import { ConfigureScanner } from './ConfigureScanner';
import { BrowseGraviScans } from './BrowseGraviScans';
import { ExperimentDetail } from './ExperimentDetail';
import { useAppMode } from './hooks/useAppMode';
import { UploadStatusProvider } from './contexts/UploadStatusContext';
import { WaveMetadataLinksProvider } from './contexts/WaveMetadataLinksContext';

// Lazy-loaded: Metadata is GraviScan-only, so there's no reason to bundle
// it (and its Excel-parsing UI) into every mode's initial load.
const Metadata = lazy(() =>
  import('./Metadata').then((m) => ({ default: m.Metadata }))
);

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
    <UploadStatusProvider>
      <WaveMetadataLinksProvider>
        <Router initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Layout mode={mode} />}>
              <Route index element={<Home mode={mode} />} />

              {/* Capture routes — conditional on scanner mode */}
              {mode === 'cylinderscan' && (
                <>
                  <Route
                    path="camera-settings"
                    element={<CameraSettings />}
                  />
                  <Route path="capture-scan" element={<CaptureScan />} />
                  <Route path="accessions" element={<Accessions />} />
                </>
              )}

              {mode === 'graviscan' && (
                <>
                  <Route
                    path="configure-scanner"
                    element={<ConfigureScanner />}
                  />
                  <Route
                    path="browse-graviscans"
                    element={<BrowseGraviScans />}
                  />
                  <Route
                    path="graviscan-experiment/:experimentId"
                    element={<ExperimentDetail />}
                  />
                  <Route
                    path="metadata"
                    element={
                      <Suspense fallback={<div>Loading...</div>}>
                        <Metadata />
                      </Suspense>
                    }
                  />
                </>
              )}

              {/* Data entry routes — available for all modes */}
              <Route path="scientists" element={<Scientists />} />
              <Route path="phenotypers" element={<Phenotypers />} />
              <Route
                path="experiments"
                element={<Experiments mode={mode} />}
              />

              {/* Browse routes — always visible */}
              <Route path="browse-scans" element={<BrowseScans />} />
              <Route path="scan/:scanId" element={<ScanPreview />} />
              <Route path="export" element={<Export />} />

              {/* Config */}
              <Route
                path="machine-config"
                element={<MachineConfiguration />}
              />

              {/* Catch-all redirect */}
              <Route path="*" element={<Navigate to="/" />} />
            </Route>
          </Routes>
        </Router>
      </WaveMetadataLinksProvider>
    </UploadStatusProvider>
  );
}
