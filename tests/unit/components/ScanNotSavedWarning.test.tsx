/**
 * Unit tests for ScanNotSavedWarning (#392)
 *
 * The database error is shown as one truncated line, with the full message
 * available on hover, so long multi-line Prisma errors can't overflow the
 * warning.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ScanNotSavedWarning } from '../../../src/components/ScanNotSavedWarning';

const OUTPUT_PATH = 'E:\\bloom-scans\\2026-10-12\\PLANT-001\\scan-uuid';
const PRISMA_ERROR = [
  '',
  'Invalid `prisma.scan.create()` invocation in',
  'C:\\Users\\PBIOB-GH\\bloom-desktop\\.webpack\\main\\index.js:1234:56',
  '',
  'Foreign key constraint failed on the field: `experiment_id`',
].join('\n');

describe('ScanNotSavedWarning', () => {
  it('shows the folder the images were written to', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByTestId('scan-not-saved-path')).toHaveTextContent(
      OUTPUT_PATH
    );
  });

  it('shows only the first non-empty line of a multi-line error', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: PRISMA_ERROR }}
        onDismiss={vi.fn()}
      />
    );

    const error = screen.getByTestId('scan-not-saved-error');
    expect(error).toHaveTextContent(
      'Database error: Invalid `prisma.scan.create()` invocation in'
    );
    expect(error).not.toHaveTextContent('Foreign key constraint failed');
  });

  it('truncates the error line with an ellipsis and keeps the full text on hover', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: PRISMA_ERROR }}
        onDismiss={vi.fn()}
      />
    );

    const error = screen.getByTestId('scan-not-saved-error');
    expect(error).toHaveClass('truncate');
    expect(error).toHaveAttribute('title', PRISMA_ERROR);
  });

  it('shows a single-line error unchanged', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: 'database is locked' }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByTestId('scan-not-saved-error')).toHaveTextContent(
      'Database error: database is locked'
    );
  });

  it('omits the error line when there is no error message', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH }}
        onDismiss={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('scan-not-saved-error')
    ).not.toBeInTheDocument();
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH }}
        onDismiss={onDismiss}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Dismiss scan not saved warning/i })
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
