import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Metadata } from '../../../src/renderer/Metadata';

describe('Metadata', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.graviPlateAccessions = {
      listFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
  });

  it('renders both the upload and list components unconditionally, with no internal mode branch', async () => {
    const { container } = render(<Metadata />);
    await waitFor(() => {
      expect(container.querySelector('#metadata-file-input')).not.toBeNull();
    });
    // GraviMetadataList resolves its initial fetch asynchronously (a loading
    // message first, then an empty-state message for this mock's empty
    // list) — wait for it to settle rather than asserting immediately, to
    // confirm both children mounted together without racing the list's own
    // async state.
    await waitFor(() => {
      expect(
        container.textContent?.includes('No GraviScan metadata uploaded yet')
      ).toBe(true);
    });
  });
});
