/**
 * Unit tests for DeleteConfirmModal (add-cylinderscan-delete-upload-integrity,
 * tasks.md 2.1) — shared delete-confirmation modal used by both
 * BrowseScans.tsx and ScanPreview.tsx, matching the "Delete Scan"
 * requirement's modal (Plant ID + capture date, Cancel/Delete buttons).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DeleteConfirmModal } from '../../../src/renderer/components/DeleteConfirmModal';

describe('DeleteConfirmModal', () => {
  it('renders the Plant ID and capture date', () => {
    render(
      <DeleteConfirmModal
        plantId="PLANT-001"
        captureDate="Feb 17, 2026 10:30 AM"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/PLANT-001/)).toBeInTheDocument();
    expect(screen.getByText(/Feb 17, 2026 10:30 AM/)).toBeInTheDocument();
  });

  it('has Cancel and Delete buttons', () => {
    render(
      <DeleteConfirmModal
        plantId="PLANT-001"
        captureDate="Feb 17, 2026 10:30 AM"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /cancel/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete/i })
    ).toBeInTheDocument();
  });

  it('calls onConfirm when Delete is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmModal
        plantId="PLANT-001"
        captureDate="Feb 17, 2026 10:30 AM"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <DeleteConfirmModal
        plantId="PLANT-001"
        captureDate="Feb 17, 2026 10:30 AM"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
