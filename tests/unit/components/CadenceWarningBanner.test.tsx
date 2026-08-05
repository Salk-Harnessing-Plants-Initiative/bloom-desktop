import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CadenceWarningBanner } from '../../../src/renderer/components/graviscan/CadenceWarningBanner';
import type { CadenceEstimatorInput } from '../../../src/renderer/utils/cadenceEstimator';

function props(overrides: Partial<CadenceEstimatorInput> = {}, intervalMinutes = 5) {
  const cadenceContext: CadenceEstimatorInput = {
    platesPerScanner: 4,
    scannerCount: 5,
    dpi: 1200,
    regionMm: { width: 140, height: 140 },
    ...overrides,
  };
  return { cadenceContext, intervalMinutes };
}

describe('CadenceWarningBanner', () => {
  it('shows the amber warning banner with predicted minutes, interval, and remediation copy when the estimate exceeds the interval', () => {
    render(<CadenceWarningBanner {...props({ platesPerScanner: 4 }, 5)} />);

    const banner = screen.getByTestId('cadence-warning-banner');
    expect(banner.className).toContain('bg-amber-50');
    expect(banner.className).toContain('border-amber-300');
    expect(banner.className).toContain('text-amber-800');
    expect(banner.textContent).toMatch(/5 min/i);
    expect(banner.textContent).toMatch(/fewer plates/i);
    expect(banner.textContent).toMatch(/lower dpi/i);
    expect(banner.textContent).toMatch(/smaller region/i);
  });

  it('is hidden when the estimate fits the interval', () => {
    render(<CadenceWarningBanner {...props({ platesPerScanner: 2 }, 5)} />);
    expect(screen.queryByTestId('cadence-warning-banner')).not.toBeInTheDocument();
  });

  it('reacts to a DPI change that brings the estimate back within the interval', () => {
    const { rerender } = render(<CadenceWarningBanner {...props({ dpi: 1200 }, 5)} />);
    expect(screen.getByTestId('cadence-warning-banner')).toBeInTheDocument();

    rerender(<CadenceWarningBanner {...props({ dpi: 800 }, 5)} />);
    expect(screen.queryByTestId('cadence-warning-banner')).not.toBeInTheDocument();
  });

  it('reacts to a platesPerScanner (grid_mode) change that brings the estimate back within the interval', () => {
    const { rerender } = render(<CadenceWarningBanner {...props({ platesPerScanner: 4 }, 5)} />);
    expect(screen.getByTestId('cadence-warning-banner')).toBeInTheDocument();

    rerender(<CadenceWarningBanner {...props({ platesPerScanner: 2 }, 5)} />);
    expect(screen.queryByTestId('cadence-warning-banner')).not.toBeInTheDocument();
  });

  it('reacts to a scannerCount change', () => {
    const { rerender } = render(
      <CadenceWarningBanner {...props({ platesPerScanner: 1, scannerCount: 1 }, 5)} />
    );
    expect(screen.queryByTestId('cadence-warning-banner')).not.toBeInTheDocument();

    rerender(<CadenceWarningBanner {...props({ platesPerScanner: 1, scannerCount: 20 }, 5)} />);
    expect(screen.getByTestId('cadence-warning-banner')).toBeInTheDocument();
  });

  it('the existing overtime banner is a separate concern — this component renders nothing about overtime', () => {
    render(<CadenceWarningBanner {...props({ platesPerScanner: 4 }, 5)} />);
    expect(screen.queryByText(/overtime/i)).not.toBeInTheDocument();
  });
});
