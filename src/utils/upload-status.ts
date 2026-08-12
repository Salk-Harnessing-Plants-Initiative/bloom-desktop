export interface UploadStatusCounts {
  pending: number;
  failed: number;
  uploaded: number;
}

/**
 * Low-level, id-agnostic upload-status counter. Shared by BrowseScans.tsx's
 * per-scan status label and Home.tsx's cross-scan "Today's Activity"
 * aggregate — takes only `status`, so it works for both BrowseScans'
 * `{id, status}` images and db:scans:getRecent's `{status}`-only images.
 */
export function countUploadStatuses(
  images: { status: string }[]
): UploadStatusCounts {
  return images.reduce(
    (counts, image) => {
      if (image.status === 'uploaded') {
        counts.uploaded += 1;
      } else if (image.status === 'failed') {
        counts.failed += 1;
      } else if (image.status === 'pending' || image.status === 'uploading') {
        counts.pending += 1;
      }
      return counts;
    },
    { pending: 0, failed: 0, uploaded: 0 }
  );
}
