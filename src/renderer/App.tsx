import 'tailwindcss/tailwind.css';
import './App.css';

import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout } from './Layout';
import { Home } from './Home';
import { CameraSettings } from './CameraSettings';
import { CaptureScan } from './CaptureScan';
import { Scientists } from './Scientists';
import { Phenotypers } from './Phenotypers';
import { Accessions } from './Accessions';
import { Experiments } from './Experiments';
import { BrowseScans } from './BrowseScans';
import { MachineConfiguration } from './MachineConfiguration';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="camera-settings" element={<CameraSettings />} />
          <Route path="capture-scan" element={<CaptureScan />} />
          <Route path="scientists" element={<Scientists />} />
          <Route path="phenotypers" element={<Phenotypers />} />
          <Route path="accessions" element={<Accessions />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="browse-scans" element={<BrowseScans />} />
          <Route
            path="scan/:scanId"
            element={
              <div className="p-6">
                <h1 className="text-2xl font-bold mb-4">Scan Preview</h1>
                <p className="text-gray-500">Coming soon in Phase 4</p>
              </div>
            }
          />
          <Route path="machine-config" element={<MachineConfiguration />} />
        </Route>
      </Routes>
    </Router>
  );
}
