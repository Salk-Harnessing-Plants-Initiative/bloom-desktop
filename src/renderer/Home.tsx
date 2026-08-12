import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PythonStatus } from './components/PythonStatus';
import { WorkflowSteps, graviScanSteps } from './components/WorkflowSteps';
import { CylinderScanWorkflowGuide } from './components/CylinderScanWorkflowGuide';
import { countUploadStatuses } from '../utils/upload-status';

interface HomeProps {
  mode?: string | null;
}

interface TodaysActivityScan {
  id: string;
  plant_id: string;
  capture_date: Date | string;
  experiment?: { name: string } | null;
  images: { status: string }[];
}

export function Home({ mode = null }: HomeProps) {
  const navigate = useNavigate();
  const [isCheckingConfig, setIsCheckingConfig] = useState(true);
  const [recentScans, setRecentScans] = useState<TodaysActivityScan[] | null>(
    null
  );
  const [failedUploadCount, setFailedUploadCount] = useState(0);

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

  // Today's Activity is CylinderScan-only, matching PythonStatus's existing
  // mode gate — leaves GraviScan's Home screen (and its render path) untouched.
  useEffect(() => {
    if (mode !== 'cylinderscan') return;
    let mounted = true;
    window.electron.database.scans
      .getRecent({ limit: 10 })
      .then((result) => {
        if (!mounted) return;
        setRecentScans(result.success && result.data ? result.data : []);
      })
      .catch((error: unknown) => {
        console.error("Failed to load today's activity:", error);
        if (mounted) setRecentScans([]);
      });
    return () => {
      mounted = false;
    };
  }, [mode]);

  // Date-unscoped failed-upload indicator — separate from Today's Activity's
  // today-only scoping, so a stale failed upload from a prior day still surfaces.
  useEffect(() => {
    if (mode !== 'cylinderscan') return;
    let mounted = true;
    window.electron.database.scans
      .getFailedUploadCount()
      .then((result) => {
        if (!mounted) return;
        if (result.success && result.data) {
          setFailedUploadCount(result.data.failedCount);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load failed-upload count:', error);
      });
    return () => {
      mounted = false;
    };
  }, [mode]);

  // Show loading while checking config
  if (isCheckingConfig) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  const modeLabel = mode === 'graviscan' ? 'GraviScan' : 'CylinderScan';
  const uploadCounts = recentScans
    ? recentScans.reduce(
        (totals, scan) => {
          const counts = countUploadStatuses(scan.images);
          return {
            pending: totals.pending + counts.pending,
            failed: totals.failed + counts.failed,
            uploaded: totals.uploaded + counts.uploaded,
          };
        },
        { pending: 0, failed: 0, uploaded: 0 }
      )
    : null;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2 text-gray-800">Bloom Desktop</h1>
      <p className="text-gray-600 mb-8">
        {modeLabel} workflow — follow these steps to capture and manage scans.
      </p>

      {mode === 'graviscan' ? (
        <>
          <h2 className="text-xl font-semibold mb-4 text-gray-700">
            Workflow Steps
          </h2>
          <WorkflowSteps steps={graviScanSteps} />
        </>
      ) : (
        <CylinderScanWorkflowGuide />
      )}

      {mode === 'cylinderscan' && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">
            Today&apos;s Activity
          </h2>

          {failedUploadCount > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
              <span className="text-red-700 font-medium">
                {failedUploadCount} failed upload
                {failedUploadCount === 1 ? '' : 's'} need attention
              </span>
              <Link
                to="/browse-scans"
                className="text-lime-700 hover:text-lime-800 font-medium"
              >
                Browse Scans →
              </Link>
            </div>
          )}

          {recentScans === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : recentScans.length === 0 ? (
            <p className="text-sm text-gray-500">No scans captured today.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">
                  {uploadCounts!.uploaded} uploaded
                </span>
                <span className="text-yellow-600">
                  {uploadCounts!.pending} pending
                </span>
                <span className="text-red-600">
                  {uploadCounts!.failed} failed
                </span>
              </div>
              <ul className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200">
                {recentScans.map((scan) => (
                  <li
                    key={scan.id}
                    className="p-3 flex justify-between items-center text-sm"
                  >
                    <span className="font-medium">{scan.plant_id}</span>
                    <span className="text-gray-500">
                      {scan.experiment?.name || '-'}
                    </span>
                    <span className="text-gray-500">
                      {new Date(scan.capture_date).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Python Backend Status */}
      <div className="mt-8">
        <PythonStatus mode={mode} />
      </div>
    </div>
  );
}
