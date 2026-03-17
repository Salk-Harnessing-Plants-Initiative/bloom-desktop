/**
 * Unit Tests: ExperimentForm Component
 *
 * Tests for the ExperimentForm component to ensure validation,
 * submission, and error handling work correctly.
 *
 * Key validation rules (per issue #103):
 * - Name is required
 * - Species is required (has default)
 * - Scientist is required (was optional)
 * - Accession is required (was optional)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ExperimentForm } from '../../../src/renderer/components/ExperimentForm';

// Mock the window.electron.database.experiments.create API
const mockCreate = vi.fn();

const mockScientists = [
  { id: 'sci-1', name: 'Dr. Jane Smith', email: 'jane@example.com' },
  { id: 'sci-2', name: 'Dr. Bob Brown', email: 'bob@example.com' },
];

const mockAccessions = [
  { id: 'acc-1', name: 'Accession File A' },
  { id: 'acc-2', name: 'Accession File B' },
];

beforeEach(() => {
  mockCreate.mockReset();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron && win.electron.database) {
    win.electron.database.experiments = {
      create: mockCreate,
    };
  }
});

/**
 * Helper to get form elements by their stable IDs (independent of label text)
 */
function getFormElements() {
  const nameInput = document.getElementById('experiment-name');
  const speciesSelect = document.getElementById('species-select');
  const scientistSelect = document.getElementById('scientist-select');
  const accessionSelect = document.getElementById('accession-select');

  if (!nameInput) throw new Error('experiment-name input not found');
  if (!speciesSelect) throw new Error('species-select not found');
  if (!scientistSelect) throw new Error('scientist-select not found');
  if (!accessionSelect) throw new Error('accession-select not found');

  return {
    nameInput: nameInput as HTMLInputElement,
    speciesSelect: speciesSelect as HTMLSelectElement,
    scientistSelect: scientistSelect as HTMLSelectElement,
    accessionSelect: accessionSelect as HTMLSelectElement,
    submitButton: screen.getByRole('button', { name: /create/i }),
  };
}

describe('ExperimentForm', () => {
  it('should render all form fields', () => {
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const {
      nameInput,
      speciesSelect,
      scientistSelect,
      accessionSelect,
      submitButton,
    } = getFormElements();

    expect(nameInput).toBeInTheDocument();
    expect(speciesSelect).toBeInTheDocument();
    expect(scientistSelect).toBeInTheDocument();
    expect(accessionSelect).toBeInTheDocument();
    expect(submitButton).toBeInTheDocument();
  });

  it('should show validation error when scientist is not selected', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, accessionSelect, submitButton } = getFormElements();

    // Fill name but leave scientist as default (empty)
    await user.type(nameInput, 'Test Experiment');
    // Select an accession
    await user.selectOptions(accessionSelect, 'acc-1');
    // Do NOT select a scientist

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Scientist is required')).toBeInTheDocument();
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should show validation error when accession is not selected', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, scientistSelect, submitButton } = getFormElements();

    // Fill name and select scientist, but leave accession empty
    await user.type(nameInput, 'Test Experiment');
    await user.selectOptions(scientistSelect, 'sci-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Accession is required')).toBeInTheDocument();
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should call IPC with scientist and accession connected on valid submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    mockCreate.mockResolvedValue({
      success: true,
      data: {
        id: 'exp-1',
        name: 'Test Experiment',
        species: 'Alfalfa',
        scientist_id: 'sci-1',
        accession_id: 'acc-1',
      },
    });

    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, scientistSelect, accessionSelect, submitButton } =
      getFormElements();

    await user.type(nameInput, 'Test Experiment');
    await user.selectOptions(scientistSelect, 'sci-1');
    await user.selectOptions(accessionSelect, 'acc-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Test Experiment',
        species: 'Alfalfa',
        scientist: { connect: { id: 'sci-1' } },
        accession: { connect: { id: 'acc-1' } },
      });
    });

    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it('should not show "(optional)" in scientist and accession labels', () => {
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    // Find labels by their "for" attribute (htmlFor)
    const scientistLabel = document.querySelector(
      'label[for="scientist-select"]'
    );
    const accessionLabel = document.querySelector(
      'label[for="accession-select"]'
    );

    expect(scientistLabel).not.toBeNull();
    expect(accessionLabel).not.toBeNull();
    expect(scientistLabel!.textContent).not.toContain('optional');
    expect(accessionLabel!.textContent).not.toContain('optional');
  });

  it('should show validation error for whitespace-only name', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, scientistSelect, accessionSelect, submitButton } =
      getFormElements();

    // Enter only whitespace
    await user.type(nameInput, '   ');
    await user.selectOptions(scientistSelect, 'sci-1');
    await user.selectOptions(accessionSelect, 'acc-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should show validation error for empty name', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { scientistSelect, accessionSelect, submitButton } =
      getFormElements();

    // Select scientist and accession but leave name empty
    await user.selectOptions(scientistSelect, 'sci-1');
    await user.selectOptions(accessionSelect, 'acc-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should reset form after successful submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    mockCreate.mockResolvedValue({
      success: true,
      data: { id: 'exp-1', name: 'Test', species: 'Alfalfa' },
    });

    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, scientistSelect, accessionSelect, submitButton } =
      getFormElements();

    await user.type(nameInput, 'Test Experiment');
    await user.selectOptions(scientistSelect, 'sci-1');
    await user.selectOptions(accessionSelect, 'acc-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(nameInput.value).toBe('');
    });

    expect(mockOnSuccess).toHaveBeenCalled();
  });

  it('should display error message on submission failure', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    mockCreate.mockResolvedValue({
      success: false,
      error: 'Database error occurred',
    });

    render(
      <ExperimentForm
        scientists={mockScientists}
        accessions={mockAccessions}
        onSuccess={mockOnSuccess}
      />
    );

    const { nameInput, scientistSelect, accessionSelect, submitButton } =
      getFormElements();

    await user.type(nameInput, 'Test');
    await user.selectOptions(scientistSelect, 'sci-1');
    await user.selectOptions(accessionSelect, 'acc-1');

    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Database error occurred')).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });
});
