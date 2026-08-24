/**
 * Unit tests: countUploadStatuses (Tier 4, #104)
 *
 * A low-level, id-agnostic counter shared by BrowseScans.tsx's existing
 * per-scan upload-status label (rewritten to call this internally) and
 * Home.tsx's cross-scan "Today's Activity" aggregate. Deliberately takes
 * `{ status: string }[]` — no `id` required — so it works for both
 * BrowseScans' `{id, status}` images and getRecent's `{status}`-only images.
 */

import { describe, it, expect } from 'vitest';
import { countUploadStatuses } from '../../src/utils/upload-status';

describe('countUploadStatuses', () => {
  it('counts mixed statuses into all three buckets', () => {
    const result = countUploadStatuses([
      { status: 'uploaded' },
      { status: 'uploaded' },
      { status: 'failed' },
      { status: 'pending' },
    ]);

    expect(result).toEqual({ pending: 1, failed: 1, uploaded: 2 });
  });

  it('counts both "pending" and "uploading" as pending', () => {
    const result = countUploadStatuses([
      { status: 'pending' },
      { status: 'uploading' },
    ]);

    expect(result).toEqual({ pending: 2, failed: 0, uploaded: 0 });
  });

  it('returns all zeros for an empty array', () => {
    expect(countUploadStatuses([])).toEqual({
      pending: 0,
      failed: 0,
      uploaded: 0,
    });
  });

  it('works with {id, status} objects too (extra fields are ignored)', () => {
    const result = countUploadStatuses([
      { id: 'img-1', status: 'uploaded' },
      { id: 'img-2', status: 'failed' },
    ]);

    expect(result).toEqual({ pending: 0, failed: 1, uploaded: 1 });
  });
});
