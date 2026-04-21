/**
 * Metadata Page (GraviScan Section 10)
 *
 * Provides experiment/phenotyper selection, wave number configuration,
 * and plate assignment editing before starting a scan session.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlateAssignments } from '../hooks/usePlateAssignments';
import { useWaveNumber } from '../hooks/useWaveNumber';
import { PlateGridEditor } from '../../components/graviscan/PlateGridEditor';
import type { GraviConfig, ScannerAssignment } from '../../types/graviscan';

interface ExperimentOption {
  id: string;
  name: string;
  species: string;
}

interface PhenotyperOption {
  id: string;
  name: string;
}

export function Metadata() {
  const navigate = useNavigate();

  // Config state
  const [config, setConfig] = useState<GraviConfig | null | undefined>(
    undefined
  );
  const [configLoading, setConfigLoading] = useState(true);

  // Dropdowns
  const [experiments, setExperiments] = useState<ExperimentOption[]>([]);
  const [phenotypers, setPhenotypers] = useState<PhenotyperOption[]>([]);
  const [selectedExperiment, setSelectedExperiment] = useState('');
  const [selectedPhenotyper, setSelectedPhenotyper] = useState('');

  // Scan error for plate assignment hook
  const [scanError, setScanError] = useState<string | null>(null);

  // Scanner assignments from config (in a real flow, these come from saved config)
  const [scannerAssignments, setScannerAssignments] = useState<
    ScannerAssignment[]
  >([]);

  // Load config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const result = await window.electron.gravi.getConfig();
        if (result.success && result.config) {
          setConfig(result.config);
          // Build scanner assignments from config defaults
          setScannerAssignments([
            {
              slot: 'Scanner 1',
              scannerId: 'scanner-1',
              usbPort: null,
              gridMode: result.config.grid_mode,
            },
          ]);
        } else {
          setConfig(null);
        }
      } catch {
        setConfig(null);
      } finally {
        setConfigLoading(false);
      }
    }
    loadConfig();
  }, []);

  // Load experiments and phenotypers
  useEffect(() => {
    async function loadDropdownData() {
      try {
        const [expResult, phenResult] = await Promise.all([
          window.electron.database.experiments.list(),
          window.electron.database.phenotypers.list(),
        ]);
        if (expResult.success && expResult.data) {
          setExperiments(expResult.data as ExperimentOption[]);
        }
        if (phenResult.success && phenResult.data) {
          setPhenotypers(phenResult.data as PhenotyperOption[]);
        }
      } catch (error) {
        console.error('Failed to load dropdown data:', error);
      }
    }
    loadDropdownData();
  }, []);

  // Plate assignments hook
  const { scannerPlateAssignments, handleTogglePlate, handlePlateBarcode } =
    usePlateAssignments({
      selectedExperiment,
      scannerAssignments,
      setScanError,
    });

  // Wave number hook
  const { waveNumber, setWaveNumber } = useWaveNumber({
    selectedExperiment,
    scannerPlateAssignments,
    scanCompletionCounter: 0,
  });

  // Loading state
  if (configLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading configuration...</p>
      </div>
    );
  }

  // No-config guard
  if (!config) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto text-center py-16">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Scanner Not Configured
          </h1>
          <p className="text-gray-600 mb-6">
            Please configure scanners first before setting up metadata.
          </p>
          <button
            type="button"
            onClick={() => navigate('/scanner-config')}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            Go to Scanner Config
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Scan Metadata</h1>
          <p className="text-gray-600 mt-1">
            Configure experiment, phenotyper, and plate assignments
          </p>
        </div>

        {/* Error banner */}
        {scanError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
            {scanError}
          </div>
        )}

        {/* Experiment & Phenotyper */}
        <div className="bg-white rounded-lg shadow-sm p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="experiment"
              className="block text-sm font-semibold text-gray-700 mb-1"
            >
              Experiment
            </label>
            <select
              id="experiment"
              value={selectedExperiment}
              onChange={(e) => setSelectedExperiment(e.target.value)}
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Experiment</option>
              {experiments.map((exp) => (
                <option key={exp.id} value={exp.id}>
                  {exp.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="phenotyper"
              className="block text-sm font-semibold text-gray-700 mb-1"
            >
              Phenotyper
            </label>
            <select
              id="phenotyper"
              value={selectedPhenotyper}
              onChange={(e) => setSelectedPhenotyper(e.target.value)}
              className="w-full p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Phenotyper</option>
              {phenotypers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Wave Number */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <label
            htmlFor="waveNumber"
            className="block text-sm font-semibold text-gray-700 mb-1"
          >
            Wave Number
          </label>
          <input
            id="waveNumber"
            type="number"
            min={0}
            value={waveNumber}
            onChange={(e) => setWaveNumber(Number(e.target.value))}
            className="w-full max-w-xs p-2 rounded-md bg-white text-sm border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Plate Assignments */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Plate Assignments
          </h2>
          {Object.entries(scannerPlateAssignments).map(
            ([scannerId, assignments]) => (
              <div key={scannerId} className="mb-6 last:mb-0">
                <h3 className="text-sm font-medium text-gray-600 mb-3">
                  Scanner: {scannerId}
                </h3>
                <PlateGridEditor
                  assignments={assignments}
                  onToggle={(plateIndex) =>
                    handleTogglePlate(scannerId, plateIndex)
                  }
                  onBarcodeChange={(plateIndex, barcode) =>
                    handlePlateBarcode(scannerId, plateIndex, barcode)
                  }
                />
              </div>
            )
          )}
          {Object.keys(scannerPlateAssignments).length === 0 && (
            <p className="text-sm text-gray-500">
              No scanners assigned. Select an experiment to load plate
              assignments.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => navigate('/graviscan')}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
