/**
 * Unit Tests: ExperimentForm Component
 *
 * Tests validation schema requiring scientist and accession fields,
 * form labels, and error display for required fields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ExperimentForm } from '../../../src/renderer/components/ExperimentForm';

// Mock the window.electron.database.experiments.create API
const mockCreate = vi.fn();

const defaultScientists = [
  { id: 'sci-1', name: 'Dr. Jane Smith', email: 'jane@example.com' },
  { id: 'sci-2', name: 'Dr. Bob Brown', email: 'bob@example.com' },
];

const defaultAccessions = [
  { id: 'acc-1', name: 'Accession File A' },
  { id: 'acc-2', name: 'Accession File B' },
];

beforeEach(() => {
  mockCreate.mockReset();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron && win.electron.database) {
    win.electron.database.experiments.create = mockCreate;
  }
});

describe('ExperimentForm', () => {
  describe('Zod schema validation', () => {
    it('should reject empty scientist_id', async () => {
      const user = userEvent.setup();
      const mockOnSuccess = vi.fn();
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={mockOnSuccess}
        />
      );

      // Fill name, select accession, but leave scientist empty
      await user.type(screen.getByLabelText('Name'), 'Test Experiment');
      await user.selectOptions(
        screen.getByLabelText('Accession File'),
        'acc-1'
      );

      // Submit
      await user.click(screen.getByRole('button', { name: /create/i }));

      // Verify validation error
      await waitFor(() => {
        expect(screen.getByText('Scientist is required')).toBeInTheDocument();
      });

      // Verify IPC was NOT called
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject empty accession_id', async () => {
      const user = userEvent.setup();
      const mockOnSuccess = vi.fn();
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={mockOnSuccess}
        />
      );

      // Fill name, select scientist, but leave accession empty
      await user.type(screen.getByLabelText('Name'), 'Test Experiment');
      await user.selectOptions(screen.getByLabelText('Scientist'), 'sci-1');

      // Submit
      await user.click(screen.getByRole('button', { name: /create/i }));

      // Verify validation error
      await waitFor(() => {
        expect(
          screen.getByText('Accession file is required')
        ).toBeInTheDocument();
      });

      // Verify IPC was NOT called
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only name', async () => {
      const user = userEvent.setup();
      const mockOnSuccess = vi.fn();
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={mockOnSuccess}
        />
      );

      // Fill name with only spaces, select scientist and accession
      await user.type(screen.getByLabelText('Name'), '   ');
      await user.selectOptions(screen.getByLabelText('Scientist'), 'sci-1');
      await user.selectOptions(
        screen.getByLabelText('Accession File'),
        'acc-1'
      );

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should accept valid scientist_id and accession_id', async () => {
      const user = userEvent.setup();
      const mockOnSuccess = vi.fn();
      mockCreate.mockResolvedValue({ success: true, data: { id: '123' } });

      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={mockOnSuccess}
        />
      );

      // Fill all required fields
      await user.type(screen.getByLabelText('Name'), 'Test Experiment');
      await user.selectOptions(screen.getByLabelText('Scientist'), 'sci-1');
      await user.selectOptions(
        screen.getByLabelText('Accession File'),
        'acc-1'
      );

      // Submit
      await user.click(screen.getByRole('button', { name: /create/i }));

      // Verify IPC was called with scientist and accession connected
      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith({
          name: 'Test Experiment',
          species: 'Alfalfa',
          scientist: { connect: { id: 'sci-1' } },
          accession: { connect: { id: 'acc-1' } },
        });
      });
    });
  });

  describe('Form labels', () => {
    it('should render Scientist label without "(optional)"', () => {
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={vi.fn()}
        />
      );

      const label = screen.getByLabelText('Scientist');
      expect(label).toBeInTheDocument();
      // Ensure no "(optional)" text anywhere near the scientist label
      expect(
        screen.queryByText(/Scientist.*\(optional\)/)
      ).not.toBeInTheDocument();
    });

    it('should render Accession File label without "(optional)"', () => {
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={vi.fn()}
        />
      );

      const label = screen.getByLabelText('Accession File');
      expect(label).toBeInTheDocument();
      // Ensure no "(optional)" text anywhere near the accession label
      expect(
        screen.queryByText(/Accession File.*\(optional\)/)
      ).not.toBeInTheDocument();
    });
  });

  describe('Validation error display', () => {
    it('should show validation error when scientist is not selected', async () => {
      const user = userEvent.setup();
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={vi.fn()}
        />
      );

      // Fill name and accession but not scientist
      await user.type(screen.getByLabelText('Name'), 'Test');
      await user.selectOptions(
        screen.getByLabelText('Accession File'),
        'acc-1'
      );

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(screen.getByText('Scientist is required')).toBeInTheDocument();
      });
    });

    it('should show validation error when accession is not selected', async () => {
      const user = userEvent.setup();
      render(
        <ExperimentForm
          scientists={defaultScientists}
          accessions={defaultAccessions}
          onSuccess={vi.fn()}
        />
      );

      // Fill name and scientist but not accession
      await user.type(screen.getByLabelText('Name'), 'Test');
      await user.selectOptions(screen.getByLabelText('Scientist'), 'sci-1');

      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(
          screen.getByText('Accession file is required')
        ).toBeInTheDocument();
      });
    });
  });
});
