/**
 * Unit tests for Home page — mode-aware workflow steps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Home } from '../../../src/renderer/Home';

// Track navigations
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock window.electron
const mockConfigAPI = {
  exists: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }),
};

const mockPythonAPI = {
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn().mockResolvedValue({ camera: false, daq: false }),
  onStatus: vi.fn(),
  onError: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigAPI.exists.mockResolvedValue(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      config: mockConfigAPI,
      python: mockPythonAPI,
    };
  }
});

describe('Home page', () => {
  it('renders CylinderScan workflow steps when mode is cylinderscan', async () => {
    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow Steps')).toBeInTheDocument();
    });

    // CylinderScan has 7 steps including Camera Settings and Accessions
    expect(screen.getByText('Camera Settings')).toBeInTheDocument();
    expect(screen.getByText('Accessions')).toBeInTheDocument();
    expect(screen.getByText(/CylinderScan workflow/)).toBeInTheDocument();
  });

  it('renders GraviScan workflow steps when mode is graviscan', async () => {
    render(
      <MemoryRouter>
        <Home mode="graviscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow Steps')).toBeInTheDocument();
    });

    // GraviScan has Metadata step, no Camera Settings
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.queryByText('Camera Settings')).not.toBeInTheDocument();
  });

  it('each step navigates to correct route on click', async () => {
    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Scientists')).toBeInTheDocument();
    });

    // Click the Scientists step
    fireEvent.click(screen.getByTestId('workflow-step-1'));
    expect(mockNavigate).toHaveBeenCalledWith('/scientists');
  });

  it('redirects to /machine-config when no config exists', async () => {
    mockConfigAPI.exists.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/machine-config');
    });
  });
});
