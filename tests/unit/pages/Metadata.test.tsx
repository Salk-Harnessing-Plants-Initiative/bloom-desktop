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
    // GraviMetadataList always renders its own container (a <ul>, even if
    // empty) — confirms both children mounted together, unconditionally.
    expect(container.querySelector('ul')).not.toBeNull();
  });
});
