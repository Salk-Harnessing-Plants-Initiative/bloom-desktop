import { createContext, useContext, useState, type ReactNode } from 'react';

export type AutoUploadStatus =
  | 'idle'
  | 'waiting'
  | 'uploading'
  | 'done'
  | 'error';

export interface BoxBackupProgress {
  totalImages: number;
  completedImages: number;
  failedImages: number;
  currentExperiment: string;
}

interface UploadStatusContextValue {
  autoUploadStatus: AutoUploadStatus;
  autoUploadMessage: string | null;
  boxBackupProgress: BoxBackupProgress | null;
  setAutoUploadStatus: (status: AutoUploadStatus) => void;
  setAutoUploadMessage: (msg: string | null) => void;
  setBoxBackupProgress: (progress: BoxBackupProgress | null) => void;
}

const UploadStatusContext = createContext<UploadStatusContextValue | null>(
  null
);

export function UploadStatusProvider({ children }: { children: ReactNode }) {
  const [autoUploadStatus, setAutoUploadStatus] =
    useState<AutoUploadStatus>('idle');
  const [autoUploadMessage, setAutoUploadMessage] = useState<string | null>(
    null
  );
  const [boxBackupProgress, setBoxBackupProgress] =
    useState<BoxBackupProgress | null>(null);

  return (
    <UploadStatusContext.Provider
      value={{
        autoUploadStatus,
        autoUploadMessage,
        boxBackupProgress,
        setAutoUploadStatus,
        setAutoUploadMessage,
        setBoxBackupProgress,
      }}
    >
      {children}
    </UploadStatusContext.Provider>
  );
}

export function useUploadStatus() {
  const context = useContext(UploadStatusContext);
  if (!context) {
    throw new Error(
      'useUploadStatus must be used within an UploadStatusProvider'
    );
  }
  return context;
}
