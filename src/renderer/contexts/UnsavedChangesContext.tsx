import { createContext, ReactNode, useContext, useState } from 'react';

interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  /**
   * Stronger than `hasUnsavedChanges`: an async write (e.g. the metadata
   * import's `createWithSections` IPC call) is actually in flight, not
   * just pending-and-safe-to-abandon. Navigating away mid-write would let
   * the promise resolve against an unmounted component (a silently lost
   * setError/onUploadComplete call) and risks a confused operator
   * re-submitting and creating a duplicate record — so this is a hard
   * block, not a confirm-and-proceed.
   */
  blockNavigation: boolean;
  setBlockNavigation: (value: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: () => {},
  blockNavigation: false,
  setBlockNavigation: () => {},
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
  const [blockNavigation, setBlockNavigation] = useState(false);

  return (
    <UnsavedChangesContext.Provider
      value={{
        hasUnsavedChanges,
        setHasUnsavedChanges,
        blockNavigation,
        setBlockNavigation,
      }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  return useContext(UnsavedChangesContext);
}
