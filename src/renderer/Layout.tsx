import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { WedgeBanner } from './components/WedgeBanner';
import { useUploadStatus } from './contexts/UploadStatusContext';
import { useUnsavedChanges } from './contexts/UnsavedChangesContext';
import { BoxBackupProgress } from '../types/graviscan';

function isSameProgress(
  a: BoxBackupProgress | null,
  b: BoxBackupProgress | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.totalImages === b.totalImages &&
    a.completedImages === b.completedImages &&
    a.failedImages === b.failedImages &&
    a.currentExperiment === b.currentExperiment
  );
}

function UploadStatusBanner() {
  const { status } = useUploadStatus();
  const [dismissed, setDismissed] = useState<BoxBackupProgress | null>(null);

  // Compared by value, not reference: each graviscan:upload-progress IPC
  // delivery is a fresh object (structured clone), so a harmless
  // duplicate/retry event with identical content would otherwise silently
  // undo the user's dismiss action.
  if (!status || isSameProgress(status, dismissed)) return null;

  return (
    <div data-testid="upload-status-indicator">
      <span>
        Upload progress: {status.completedImages}/{status.totalImages}
      </span>
      <button onClick={() => setDismissed(status)}>Dismiss</button>
    </div>
  );
}

/** Maps scanner_mode values to human-readable labels */
function modeLabel(mode: string | null): string {
  switch (mode) {
    case 'cylinderscan':
      return 'CylinderScan';
    case 'graviscan':
      return 'GraviScan';
    default:
      return 'Scanner';
  }
}

/** Shared links visible in every mode */
const alwaysLinks = [
  {
    to: '/',
    label: 'Home',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    ),
  },
  {
    to: '/scientists',
    label: 'Scientists',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
        />
      </svg>
    ),
  },
  {
    to: '/phenotypers',
    label: 'Phenotypers',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
        />
      </svg>
    ),
  },
  {
    to: '/experiments',
    label: 'Experiments',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
        />
      </svg>
    ),
  },
];

/**
 * The shared "Browse Scans" link — CylinderScan's Scan/Image data layer, not
 * mode-agnostic. Shown in every mode except graviscan, which has its own
 * dedicated Browse GraviScans link instead (that shared data would always be
 * empty for a GraviScan-mode user).
 */
const browseScansLink = {
  to: '/browse-scans',
  label: 'Browse Scans',
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-6 h-6 inline mr-2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
      />
    </svg>
  ),
};

/**
 * The shared "Export Scans" link — same CylinderScan-only data layer as
 * browseScansLink above, hidden in graviscan mode for the same reason.
 */
const exportScansLink = {
  to: '/export',
  label: 'Export Scans',
  icon: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-6 h-6 inline mr-2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
      />
    </svg>
  ),
};

/** Capture-specific links (cylinderscan mode only) */
const captureLinks = [
  {
    to: '/capture-scan',
    label: 'Capture Scan',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
    ),
  },
  {
    to: '/camera-settings',
    label: 'Camera Settings',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
        />
      </svg>
    ),
  },
  {
    to: '/accessions',
    label: 'Accessions',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
        />
      </svg>
    ),
  },
];

/** GraviScan-specific links (graviscan mode only) */
const graviscanLinks = [
  {
    to: '/configure-scanner',
    label: 'Configure Scanner',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.795l-.75-1.3M7.5 4.205l1.85 3.203"
        />
      </svg>
    ),
  },
  {
    to: '/metadata',
    label: 'Metadata',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>
    ),
  },
  {
    to: '/browse-graviscans',
    label: 'Browse GraviScans',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6 inline mr-2"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
        />
      </svg>
    ),
  },
];

interface LayoutProps {
  mode?: string | null;
}

export function Layout({ mode = null }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [scannerName, setScannerName] = useState<string>('');
  const { hasUnsavedChanges, blockNavigation } = useUnsavedChanges();

  // Shared by every navigation surface (sidebar links, the machine-config
  // keyboard shortcut) — a click/shortcut that doesn't actually change
  // route needs neither the hard block nor the confirm below.
  // Returns whether navigation may proceed.
  const guardNavigation = (): boolean => {
    if (blockNavigation) {
      window.alert(
        'An import is still in progress. Please wait for it to finish before navigating away.'
      );
      return false;
    }
    if (
      hasUnsavedChanges &&
      !window.confirm(
        'You have an unsaved metadata import in progress. Leave anyway?'
      )
    ) {
      return false;
    }
    return true;
  };

  const confirmNavAway = (event: React.MouseEvent, to: string) => {
    if (to === location.pathname) return;
    if (!guardNavigation()) {
      event.preventDefault();
    }
  };

  const showCaptureLinks = mode === 'cylinderscan';
  const showGraviscanLinks = mode === 'graviscan';
  const links = showCaptureLinks
    ? [...alwaysLinks, browseScansLink, exportScansLink, ...captureLinks]
    : showGraviscanLinks
      ? [...alwaysLinks, ...graviscanLinks]
      : [...alwaysLinks, browseScansLink, exportScansLink];

  // Load scanner name from scanner identity service
  useEffect(() => {
    const loadScannerName = async () => {
      try {
        const name = await window.electron.scanner.getScannerId();
        setScannerName(name || '');
      } catch (error) {
        console.error('Failed to load scanner identity:', error);
      }
    };

    // Load on mount
    loadScannerName();

    // Refresh every 2 seconds to catch config updates
    const interval = setInterval(loadScannerName, 2000);

    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcut: Ctrl/Cmd+Shift+, opens Machine Configuration
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+, (Windows/Linux) or Cmd+Shift+, (macOS)
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      // Use event.code for layout-independent key detection
      // (Shift+Comma produces different event.key on different layouts)
      if (modifier && event.shiftKey && event.code === 'Comma') {
        event.preventDefault();
        if (location.pathname === '/machine-config') return;
        if (guardNavigation()) navigate('/machine-config');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, location.pathname, blockNavigation, hasUnsavedChanges]);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-800">Bloom Desktop</h1>
          <p className="text-sm text-gray-500 mt-1">{modeLabel(mode)}</p>
        </div>

        <nav className="mt-6 flex-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end
              onClick={(event) => confirmNavAway(event, link.to)}
              className={({ isActive }) =>
                `flex items-center px-6 py-3 text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-600 border-r-4 border-blue-600'
                    : ''
                }`
              }
            >
              {link.icon}
              {link.label}
            </NavLink>
          ))}
        </nav>

        {/* Scanner name footer */}
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            Scanner: {scannerName || 'Not configured'}
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {showGraviscanLinks && <WedgeBanner />}
        <UploadStatusBanner />
        <Outlet />
      </div>
    </div>
  );
}
