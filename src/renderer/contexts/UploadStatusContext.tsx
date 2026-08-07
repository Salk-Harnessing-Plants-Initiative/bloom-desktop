import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

interface UploadStatusContextValue {
  status: unknown;
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
  const [status, setStatus] = useState<unknown>(null);

  useEffect(() => {
    const off = window.electron.gravi.onUploadProgress((data: unknown) => {
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
