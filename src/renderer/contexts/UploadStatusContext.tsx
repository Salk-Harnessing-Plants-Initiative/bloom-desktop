import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { BoxBackupProgress } from '../../types/graviscan';

interface UploadStatusContextValue {
  status: BoxBackupProgress | null;
}

const UploadStatusContext = createContext<UploadStatusContextValue>({
  status: null,
});

/**
 * Subscribes to onUploadProgress for the lifetime of the app (mounted once
 * in App.tsx) so upload/backup progress stays visible while the operator
 * navigates away from BrowseGraviScans mid-upload (design.md Decision 7).
 */
export function UploadStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BoxBackupProgress | null>(null);

  useEffect(() => {
    const off = window.electron.gravi.onUploadProgress((data) => {
      // uploadAllScans() delivers both Bloom's ({total, completed,
      // failed, currentFile}) and Box's (BoxBackupProgress) progress
      // ticks over this same channel with no discriminant tag — ignore
      // anything that isn't actually Box-shaped, or this banner (which
      // only understands BoxBackupProgress) would render
      // "undefined/undefined" on every Bloom tick.
      if (typeof data?.totalImages !== 'number') {
        return;
      }
      setStatus(data);
    });
    return off;
  }, []);

  return (
    <UploadStatusContext.Provider value={{ status }}>
      {children}
    </UploadStatusContext.Provider>
  );
}

export function useUploadStatus() {
  return useContext(UploadStatusContext);
}
