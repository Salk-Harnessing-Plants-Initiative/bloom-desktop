import { createContext, ReactNode, useContext, useState } from 'react';

interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: () => {},
});

/**
 * Mounted once in App.tsx (survives route changes) so a page with
 * in-progress, not-yet-saved work — e.g. GraviMetadataUpload.tsx's parsed
 * sheet and column mapping — can flag it, and Layout.tsx's sidebar nav can
 * confirm before a click away silently discards it (React unmounts don't
 * have a cancelable lifecycle hook, so this has to be checked *before* the
 * navigation that would cause the unmount).
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  return (
    <UnsavedChangesContext.Provider
      value={{ hasUnsavedChanges, setHasUnsavedChanges }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
