import 'tailwindcss/tailwind.css';
import './App.css';

import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './Layout';
import { Home } from './Home';
import { CameraSettings } from './CameraSettings';
import { Scanning } from './Scanning';
import { Scientists } from './Scientists';
import { Phenotypers } from './Phenotypers';
import { Metadata } from './Metadata';
import { Experiments } from './Experiments';
import { MachineConfiguration } from './MachineConfiguration';
import { BrowseScans } from './BrowseScans';
import { ExperimentDetail } from './ExperimentDetail';
import { ScanPreview } from './ScanPreview';
import { UploadStatusProvider } from './contexts/UploadStatusContext';

export default function App() {
  return (
    <UploadStatusProvider>
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          {APP_MODE !== 'graviscan' && <Route path="camera-settings" element={<CameraSettings />} />}
          <Route path="scanning" element={<Scanning />} />
          <Route path="scientists" element={<Scientists />} />
          <Route path="phenotypers" element={<Phenotypers />} />
          <Route path="metadata" element={<Metadata />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="browse-scans" element={<BrowseScans />} />
          <Route path="browse-scans/:experimentId" element={<ExperimentDetail />} />
          <Route path="scan/:scanId" element={<ScanPreview />} />
          <Route path="machine-config" element={<MachineConfiguration />} />
        </Route>
      </Routes>
    </Router>
    </UploadStatusProvider>
  );
}
