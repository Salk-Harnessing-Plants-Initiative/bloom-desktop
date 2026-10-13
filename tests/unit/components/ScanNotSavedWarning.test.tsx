/**
 * Unit tests for ScanNotSavedWarning (#392)
 *
 * The database error is shown as one truncated line (its cause, the last
 * line of a Prisma message), with the full message available on hover, so
 * long multi-line Prisma errors can't overflow the warning.
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

  it('shows the cause (last line) of a multi-line Prisma error, not its header', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: PRISMA_ERROR }}
        onDismiss={vi.fn()}
      />
    );

    const error = screen.getByTestId('scan-not-saved-error');
    expect(error).toHaveTextContent(
      'Database error: Foreign key constraint failed on the field: `experiment_id`'
    );
    expect(error).not.toHaveTextContent('Invalid `prisma.scan.create()`');
  });

  it('ignores trailing blank lines when picking the cause', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: 'database is locked\n\n  ' }}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByTestId('scan-not-saved-error')).toHaveTextContent(
      'Database error: database is locked'
    );
  });

  it('omits the error line when the message is only whitespace', () => {
    render(
      <ScanNotSavedWarning
        scan={{ outputPath: OUTPUT_PATH, error: ' \n\n ' }}
        onDismiss={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('scan-not-saved-error')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-not-saved-warning')).toBeInTheDocument();
  });

  it('applies the truncate class and keeps the full error text on hover', () => {
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
