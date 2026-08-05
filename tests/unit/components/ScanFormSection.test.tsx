import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ScanFormSection } from '../../../src/renderer/components/graviscan/ScanFormSection';
import type { PlateAssignment } from '../../../src/types/graviscan';

function plate(overrides: Partial<PlateAssignment> = {}): PlateAssignment {
  return {
    plateIndex: '00',
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    selected: true,
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof ScanFormSection>[0]> = {}) {
  return {
    scannerIds: ['sc-1'],
    scannerLabels: { 'sc-1': 'Scanner 1' },
    assignmentsByScanner: { 'sc-1': [plate()] },
    isGraviMetadata: false,
    waveMissingMetadata: true,
    waveLinkedButEmpty: false,
    loadError: null,
    updateField: vi.fn(),
    toggleSelected: vi.fn(),
    ...overrides,
  };
}

describe('ScanFormSection', () => {
  it('renders plantBarcode as an editable input (not a read-only span) when auto-filled', () => {
    render(
      <ScanFormSection
        {...baseProps({
          isGraviMetadata: true,
          waveMissingMetadata: false,
          assignmentsByScanner: { 'sc-1': [plate({ plantBarcode: 'PLATE_001' })] },
        })}
      />
    );

    const input = screen.getByDisplayValue('PLATE_001');
    expect(input.tagName).toBe('INPUT');
    expect(input).not.toHaveAttribute('readonly');
    expect(input).not.toBeDisabled();
  });

  it('renders plantBarcode as an editable input in manual mode too', () => {
    render(<ScanFormSection {...baseProps()} />);
    const input = screen.getByLabelText(/plant barcode/i);
    expect(input.tagName).toBe('INPUT');
    expect(input).not.toBeDisabled();
  });

  it('calling onChange on the barcode input calls updateField with the new value', async () => {
    const updateField = vi.fn();
    const user = userEvent.setup();
    render(<ScanFormSection {...baseProps({ updateField })} />);

    const input = screen.getByLabelText(/plant barcode/i);
    await user.type(input, 'X');

    expect(updateField).toHaveBeenCalledWith('sc-1', '00', 'plantBarcode', expect.any(String));
  });

  it('the selected checkbox toggles via toggleSelected', async () => {
    const toggleSelected = vi.fn();
    const user = userEvent.setup();
    render(<ScanFormSection {...baseProps({ toggleSelected })} />);

    await user.click(screen.getByRole('checkbox'));
    expect(toggleSelected).toHaveBeenCalledWith('sc-1', '00');
  });

  it('shows the "no link" empty state distinctly when the wave has no linked metadata', () => {
    render(<ScanFormSection {...baseProps({ waveMissingMetadata: true, waveLinkedButEmpty: false })} />);
    expect(screen.getByText(/no metadata linked/i)).toBeInTheDocument();
    expect(screen.queryByText(/linked accession has no plates/i)).not.toBeInTheDocument();
  });

  it('shows the "linked but empty accession" warning distinctly from the "no link" state', () => {
    render(
      <ScanFormSection
        {...baseProps({ waveMissingMetadata: false, waveLinkedButEmpty: true, isGraviMetadata: true })}
      />
    );
    expect(screen.getByText(/linked accession has no plates/i)).toBeInTheDocument();
    expect(screen.queryByText(/no metadata linked/i)).not.toBeInTheDocument();
  });

  it('renders the auto-fill IPC-failure inline error when loadError is set', () => {
    render(<ScanFormSection {...baseProps({ loadError: 'Failed to load wave metadata' })} />);
    expect(screen.getByText(/Failed to load wave metadata/)).toBeInTheDocument();
  });

  it('renders one section per scanner using the provided label', () => {
    render(
      <ScanFormSection
        {...baseProps({
          scannerIds: ['sc-1', 'sc-2'],
          scannerLabels: { 'sc-1': 'Scanner 1', 'sc-2': 'Scanner 2' },
          assignmentsByScanner: { 'sc-1': [plate()], 'sc-2': [plate({ plateIndex: '01' })] },
        })}
      />
    );
    expect(screen.getByText('Scanner 1')).toBeInTheDocument();
    expect(screen.getByText('Scanner 2')).toBeInTheDocument();
  });
});
