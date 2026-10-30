/**
 * Unit tests for CameraSettings page layout (Tier 4 style/UX parity, ui-layout spec)
 *
 * TDD: verifies the page adopts the same centered max-w-7xl container pattern
 * as CaptureScan.tsx (folding in the previously-pending align-page-layout-centering
 * change), while confirming the pre-existing two-panel grid/rounded-lg layout is
 * unaffected by this change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CameraSettings } from '../../../src/renderer/CameraSettings';

// The live preview streams frames over IPC; it isn't under test here.
vi.mock('../../../src/components/Streamer', () => ({
  Streamer: () => <div data-testid="streamer" />,
}));

const mockGetSettings = vi.fn().mockResolvedValue(null);
const mockStopStream = vi.fn().mockResolvedValue(undefined);
const mockConfigure = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    camera: {
      getSettings: mockGetSettings,
      stopStream: mockStopStream,
      configure: mockConfigure,
    },
  };
});

describe('CameraSettings page layout', () => {
  it('centers content in a max-w-7xl container matching CaptureScan.tsx', () => {
    const { container } = render(<CameraSettings />);

    const shell = container.querySelector('.min-h-screen.bg-gray-50.p-6');
    expect(shell).not.toBeNull();

    const centered = shell?.querySelector('.max-w-7xl.mx-auto.space-y-6');
    expect(centered).not.toBeNull();
  });

  it('uses shadow-sm (not shadow) on both panels', () => {
    const { container } = render(<CameraSettings />);

    const grid = container.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2');
    const panels = grid ? Array.from(grid.children) : [];
    expect(panels.length).toBe(2);
    panels.forEach((panel) => {
      expect(panel.className).toContain('bg-white');
      expect(panel.className).toContain('shadow-sm');
      expect(panel.className).not.toMatch(/(?<!-sm)\bshadow\b(?!-sm)/);
    });
  });

  it('keeps the pre-existing two-column grid (unaffected by this change)', () => {
    const { container } = render(<CameraSettings />);

    const grid = container.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2');
    expect(grid).not.toBeNull();
  });

  it('keeps Settings form in the left column and Live Preview in the right column', () => {
    render(<CameraSettings />);

    const headings = screen.getAllByRole('heading', { level: 2 });
    const headingTexts = headings.map((h) => h.textContent);
    const settingsIndex = headingTexts.indexOf('Settings');
    const previewIndex = headingTexts.indexOf('Live Preview');

    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(previewIndex).toBeGreaterThan(settingsIndex);
  });

  it('does not show camera-selection/auto-detection UI (#338 — moved to Machine Configuration)', () => {
    render(<CameraSettings />);

    expect(
      screen.queryByRole('button', { name: /Detect Cameras/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/How to find camera IP address/i)
    ).not.toBeInTheDocument();
  });
});

describe('CameraSettings Apply feedback', () => {
  it('shows "Not applied yet" before anything is applied', async () => {
    render(<CameraSettings />);

    expect(await screen.findByText(/Not applied yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  it('confirms a successful Apply and shows when it was applied', async () => {
    mockConfigure.mockResolvedValue({ success: true });
    render(<CameraSettings />);

    fireEvent.click(screen.getByRole('button', { name: /Apply Settings/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Camera settings applied'
    );
    const expected = new Date().toLocaleDateString();
    expect(screen.getByText(/Last applied:/)).toHaveTextContent(expected);
    expect(screen.getByTestId('camera-settings-status')).toHaveTextContent(
      'Applied to the camera, and saved for future sessions'
    );
  });

  it('says the settings are saved when they were loaded from the station', async () => {
    mockGetSettings.mockResolvedValue({
      exposure_time: 12000,
      gain: 120,
      gamma: 1.2,
      source: 'saved',
    });
    render(<CameraSettings />);

    expect(
      await screen.findByText('Saved for future sessions')
    ).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('12000').length).toBeGreaterThan(0);
    // The source is not part of the settings sent to the camera.
    mockConfigure.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: /Apply Settings/i }));
    await screen.findByRole('status');
    expect(mockConfigure.mock.calls[0][0]).not.toHaveProperty('source');
  });

  it('says the defaults are not saved yet when nothing was ever applied', async () => {
    mockGetSettings.mockResolvedValue(null);
    render(<CameraSettings />);

    expect(
      await screen.findByText('Defaults (not saved yet)')
    ).toBeInTheDocument();
  });

  it('shows the error and keeps "Unsaved changes" when the camera rejects the settings', async () => {
    mockConfigure.mockResolvedValue({
      success: false,
      error: 'Camera not connected',
    });
    render(<CameraSettings />);
    // Exposure, gain, gamma: the third number box is gamma.
    fireEvent.change(screen.getAllByRole('spinbutton')[2], {
      target: { value: '1.2' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Apply Settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Camera not connected'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText(/Not applied yet/i)).toBeInTheDocument();
  });
});
