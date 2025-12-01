/**
 * Unit Tests: AccessionForm Component
 *
 * Tests for the AccessionForm component to ensure validation,
 * submission, and error handling work correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { AccessionForm } from '../../../src/renderer/components/AccessionForm';

// Mock the window.electron.database.accessions.create API
const mockCreate = vi.fn();

beforeEach(() => {
  // Reset mocks before each test
  mockCreate.mockReset();

  // Override the global window.electron.database.accessions.create
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron && win.electron.database) {
    win.electron.database.accessions.create = mockCreate;
  }
});

describe('AccessionForm', () => {
  it('should render name field and submit button', () => {
    const mockOnSuccess = vi.fn();
    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Verify label and input are present
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add accession|create accession/i })
    ).toBeInTheDocument();
  });

  it('should show validation error for empty name', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Submit form without filling name
    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify validation error appears
    await waitFor(() => {
      expect(
        screen.getByText(/name is required|required/i)
      ).toBeInTheDocument();
    });

    // Verify IPC was NOT called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should validate max length (255 characters)', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(<AccessionForm onSuccess={mockOnSuccess} />);

    const nameInput = screen.getByLabelText('Name');

    // Fill with 256 characters (over the limit)
    const longName = 'A'.repeat(256);
    await user.type(nameInput, longName);

    // Submit form
    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify validation error appears
    await waitFor(() => {
      expect(
        screen.getByText(/maximum|too long|255/i)
      ).toBeInTheDocument();
    });

    // Verify IPC was NOT called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('should call IPC handler on valid submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    // Mock successful response
    mockCreate.mockResolvedValue({
      success: true,
      data: {
        id: '123',
        name: 'Arabidopsis Col-0',
        createdAt: new Date(),
      },
    });

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Fill form with valid data
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Arabidopsis Col-0');

    // Submit form
    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify IPC was called with correct data
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Arabidopsis Col-0',
      });
    });
  });

  it('should display error for database failures', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    // Mock database error
    mockCreate.mockResolvedValue({
      success: false,
      error: 'Database connection failed',
    });

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Test Accession');

    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify error message is displayed
    await waitFor(() => {
      expect(
        screen.getByText(/database connection failed|error/i)
      ).toBeInTheDocument();
    });

    // Verify onSuccess was NOT called
    expect(mockOnSuccess).not.toHaveBeenCalled();
  });

  it('should show loading state during submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    // Mock delayed response
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                data: { id: '123', name: 'Test', createdAt: new Date() },
              }),
            100
          )
        )
    );

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Test Accession');

    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify loading state (button disabled or loading text)
    await waitFor(() => {
      const button = screen.getByRole('button', {
        name: /add accession|create accession|loading|creating/i,
      });
      expect(button).toBeDisabled();
    });
  });

  it('should reset form after successful submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    // Mock successful response
    mockCreate.mockResolvedValue({
      success: true,
      data: {
        id: '123',
        name: 'Test Accession',
        createdAt: new Date(),
      },
    });

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Fill form
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    await user.type(nameInput, 'Test Accession');

    // Submit form
    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Wait for submission to complete
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });

    // Verify form was reset
    await waitFor(() => {
      expect(nameInput.value).toBe('');
    });
  });

  it('should disable submit button during submission', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    // Mock delayed response
    mockCreate.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                data: { id: '123', name: 'Test', createdAt: new Date() },
              }),
            100
          )
        )
    );

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Test Accession');

    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify button is disabled during submission
    expect(submitButton).toBeDisabled();

    // Wait for completion
    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });

    // Verify button is re-enabled after completion
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should clear validation errors when typing', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();
    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Trigger validation error
    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify error appears
    await waitFor(() => {
      expect(screen.getByText(/required/i)).toBeInTheDocument();
    });

    // Start typing in name field
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Test');

    // Verify error is cleared
    await waitFor(() => {
      expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
    });
  });

  it('should trim whitespace from name', async () => {
    const user = userEvent.setup();
    const mockOnSuccess = vi.fn();

    mockCreate.mockResolvedValue({
      success: true,
      data: {
        id: '123',
        name: 'Test Accession',
        createdAt: new Date(),
      },
    });

    render(<AccessionForm onSuccess={mockOnSuccess} />);

    // Fill with leading/trailing whitespace
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, '  Test Accession  ');

    const submitButton = screen.getByRole('button', {
      name: /add accession|create accession/i,
    });
    await user.click(submitButton);

    // Verify IPC was called with trimmed value
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Test Accession',
      });
    });
  });
});