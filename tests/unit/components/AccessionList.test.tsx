/**
 * Unit tests: AccessionList color palette (Tier 4 style/UX parity)
 *
 * This is the first test file for this component. Covers baseline rendering
 * plus the blue-to-lime color sweep (focus rings, edit-save button, mapping
 * edit input/link) — every blue instance in AccessionList.tsx converts to
 * its lime equivalent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccessionList } from '../../../src/renderer/components/AccessionList';

const mockGetMappings = vi.fn();
const mockUpdate = vi.fn();

const accessions = [
  { id: 'acc-1', name: 'Col-0', createdAt: new Date('2026-01-01') },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMappings.mockResolvedValue({
    success: true,
    data: [{ id: 'map-1', plant_barcode: 'P1', accession_name: 'Col-0' }],
  });
  mockUpdate.mockResolvedValue({ success: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron?.database,
      accessions: {
        ...win.electron?.database?.accessions,
        getMappings: mockGetMappings,
        update: mockUpdate,
      },
    },
  };
});

describe('AccessionList baseline rendering', () => {
  it('renders an item per accession with name and created date', () => {
    render(<AccessionList accessions={accessions} onUpdate={vi.fn()} />);
    expect(screen.getByText('Col-0')).toBeInTheDocument();
  });

  it('shows an empty state when there are no accessions', () => {
    render(<AccessionList accessions={[]} onUpdate={vi.fn()} />);
    expect(screen.getByText(/no accessions yet/i)).toBeInTheDocument();
  });
});

describe('AccessionList color palette', () => {
  it('uses focus:ring-lime-500 on the collapsed row toggle button, not blue', () => {
    render(<AccessionList accessions={accessions} onUpdate={vi.fn()} />);
    const toggle = screen.getByText('Col-0').closest('button');
    expect(toggle?.className).toContain('focus:ring-lime-500');
    expect(toggle?.className).not.toContain('focus:ring-blue-500');
  });

  it('uses lime on the mapping edit input and mapping name link', async () => {
    render(<AccessionList accessions={accessions} onUpdate={vi.fn()} />);

    // Expand the row (the toggle button) to reveal the mappings table
    fireEvent.click(screen.getByRole('button', { name: /Col-0/ }));

    await waitFor(() => {
      expect(screen.getByTestId('mappings-table')).toBeInTheDocument();
    });

    // Before editing: the mapping's accession-name link uses lime, not blue
    const mappingLink = screen.getByText('Col-0', { selector: 'span' });
    expect(mappingLink.className).toContain('hover:text-lime-600');
    expect(mappingLink.className).not.toContain('hover:text-blue-600');

    // Click it to enter inline edit
    fireEvent.click(mappingLink);

    await waitFor(() => {
      const mappingInput = screen
        .getByTestId('mappings-table')
        .querySelector('input');
      expect(mappingInput).not.toBeNull();
      expect(mappingInput?.className).toContain('focus:ring-lime-500');
      expect(mappingInput?.className).not.toContain('focus:ring-blue-500');
      expect(mappingInput?.className).not.toContain('border-blue-400');
      expect(mappingInput?.className).toContain('border-lime-400');
    });
  });

  it('uses lime on the Edit button and the name-edit input/save button', async () => {
    render(<AccessionList accessions={accessions} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Col-0/ }));

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    const editButton = screen.getByText('Edit');
    expect(editButton.className).toContain('focus:ring-lime-500');
    expect(editButton.className).not.toContain('focus:ring-blue-500');

    fireEvent.click(editButton);

    const nameInput = screen.getByDisplayValue('Col-0');
    expect(nameInput.className).toContain('focus:ring-lime-500');
    expect(nameInput.className).not.toContain('focus:ring-blue-500');

    const saveButton = screen.getByText('Save');
    expect(saveButton.className).toContain('bg-lime-700');
    expect(saveButton.className).not.toContain('bg-blue-500');
  });
});
