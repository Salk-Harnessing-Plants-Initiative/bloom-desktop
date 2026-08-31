import { useState } from 'react';
import { GraviMetadataUpload } from './components/GraviMetadataUpload';
import { GraviMetadataList } from './components/GraviMetadataList';

// No internal mode branch — this page is only ever mounted inside App.tsx's
// `{mode === 'graviscan'}` route block (design.md Decision 11), unlike the
// production branch's build-time APP_MODE tri-mode dispatch.
export function Metadata() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Metadata</h1>
      <div className="mb-6">
        <GraviMetadataUpload
          onUploadComplete={() => setRefreshKey((k) => k + 1)}
        />
      </div>
      <GraviMetadataList key={refreshKey} />
    </div>
  );
}
