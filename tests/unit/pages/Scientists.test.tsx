/**
 * Unit Tests: Scientists Page Component
 *
 * Tests for the Scientists page to ensure data fetching, state management,
 * error handling, and list rendering work correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Scientists } from '../../../src/renderer/Scientists';
import {
  unsortedScientists,
  sortedScientists,
} from '../../fixtures/scientists';

// Mock the ScientistForm component to isolate page logic
vi.mock('../../../src/renderer/components/ScientistForm', () => ({
  ScientistForm: ({ onSuccess }: { onSuccess: () => void }) => (
    <div data-testid="scientist-form">
      <button onClick={onSuccess}>Mock Create Scientist</button>
    </div>
  ),
}));

// Mock the window.electron.database.scientists.list API
const mockList = vi.fn();

beforeEach(() => {
  // Reset mocks before each test
  mockList.mockReset();

  // Override the global window.electron.database.scientists.list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win && win.electron && win.electron.database) {
    win.electron.database.scientists = {
      list: mockList,
      create: vi.fn(),
    };
  }
});

describe('Scientists Page', () => {
  it('should fetch scientists on mount', async () => {
    // Mock successful response with scientist data
    mockList.mockResolvedValue({
      success: true,
      data: [
        { id: '1', name: 'Dr. Test', email: 'test@example.com' },
      ],
    });

    render(<Scientists />);

    // Verify loading state appears initially
    expect(screen.getByText('Loading scientists...')).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    // Verify scientist appears in list
    await waitFor(() => {
      expect(screen.getByText(/Dr. Test/)).toBeInTheDocument();
      expect(screen.getByText(/test@example.com/)).toBeInTheDocument();
    });

    // Verify loading state is gone
    expect(screen.queryByText('Loading scientists...')).not.toBeInTheDocument();
  });

  it('should show loading state during fetch', async () => {
    // Mock slow response using Promise delay
    mockList.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              success: true,
              data: [],
            });
          }, 100);
        })
    );

    render(<Scientists />);

    // Verify loading indicator appears
    expect(screen.getByText('Loading scientists...')).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading scientists...')).not.toBeInTheDocument();
    });
  });

  it('should show error state when fetch fails', async () => {
    // Mock error response
    mockList.mockResolvedValue({
      success: false,
      error: 'Database connection failed',
    });

    render(<Scientists />);

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('Database connection failed')).toBeInTheDocument();
    });

    // Verify error styling applied
    const errorText = screen.getByText('Database connection failed');
    expect(errorText).toHaveClass('text-red-600');

    // Verify list is not rendered
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('should show empty state when no scientists exist', async () => {
    // Mock successful response with empty array
    mockList.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<Scientists />);

    // Wait for empty state to appear
    await waitFor(() => {
      expect(screen.getByText('No scientists yet')).toBeInTheDocument();
    });

    // Verify form is still visible
    expect(screen.getByTestId('scientist-form')).toBeInTheDocument();

    // Verify no loading or error indicators
    expect(screen.queryByText('Loading scientists...')).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });

  it('should render list of scientists alphabetically', async () => {
    // Mock API response with scientists in random order
    mockList.mockResolvedValue({
      success: true,
      data: unsortedScientists.map((s, i) => ({ ...s, id: `${i}` })),
    });

    render(<Scientists />);

    // Wait for list to render
    await waitFor(() => {
      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    // Get all list items
    const listItems = screen.getAllByRole('listitem');

    // Verify all scientists appear
    expect(listItems).toHaveLength(unsortedScientists.length);

    // Verify scientists are sorted alphabetically by name
    sortedScientists.forEach((scientist, index) => {
      expect(listItems[index]).toHaveTextContent(scientist.name);
      expect(listItems[index]).toHaveTextContent(scientist.email);
    });

    // Verify format is "Name (email)"
    expect(listItems[0]).toHaveTextContent(
      `${sortedScientists[0].name} (${sortedScientists[0].email})`
    );
  });

  it('should refresh list after successful scientist creation', async () => {
    // Mock initial response with one scientist, then second response with two
    mockList
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: '1', name: 'Dr. Initial', email: 'initial@example.com' }],
      })
      .mockResolvedValueOnce({
        success: true,
        data: [
          { id: '1', name: 'Dr. Initial', email: 'initial@example.com' },
          { id: '2', name: 'Dr. New', email: 'new@example.com' },
        ],
      });

    render(<Scientists />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText(/Dr. Initial/)).toBeInTheDocument();
    });

    // Simulate successful scientist creation via form
    const createButton = screen.getByText('Mock Create Scientist');
    createButton.click();

    // Wait for list to refresh
    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(2);
    });

    // Verify new scientist appears in list
    await waitFor(() => {
      expect(screen.getByText(/Dr. New/)).toBeInTheDocument();
      expect(screen.getByText(/new@example.com/)).toBeInTheDocument();
    });

    // Verify both scientists appear
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);
  });

  it('should handle network errors gracefully', async () => {
    // Mock unexpected error (promise rejection)
    mockList.mockRejectedValue(new Error('Network failure'));

    render(<Scientists />);

    // Wait for error to appear
    await waitFor(() => {
      expect(
        screen.getByText('An unexpected error occurred while loading scientists')
      ).toBeInTheDocument();
    });

    // Verify application doesn't crash
    expect(screen.getByTestId('scientist-form')).toBeInTheDocument();
    expect(screen.getByText('Scientists')).toBeInTheDocument();

    // Verify list is not rendered
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});