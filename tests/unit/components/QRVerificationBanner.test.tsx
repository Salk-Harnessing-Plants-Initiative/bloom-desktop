import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QRVerificationBanner } from '../../../src/renderer/components/graviscan/QRVerificationBanner';
import type { QRVerifyPlateResult } from '../../../src/types/graviscan';

function plate(overrides: Partial<QRVerifyPlateResult> = {}): QRVerifyPlateResult {
  return {
    scannerId: 'sc-1',
    plateIndex: '00',
    assignedPlateId: 'PLATE_001',
    imagePath: '/out/00.tiff',
    detectedPlateId: 'PLATE_001',
    detectedCodes: ['PLATE_001'],
    status: 'verified',
    ...overrides,
  };
}

describe('QRVerificationBanner', () => {
  it('renders nothing for an empty result set', () => {
    const { container } = render(<QRVerificationBanner results={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('grades green ("QR Verification Complete") when every plate is verified or swapped', () => {
    render(
      <QRVerificationBanner
        results={[plate({ status: 'verified' }), plate({ plateIndex: '01', status: 'swapped' })]}
      />
    );
    expect(screen.getByText(/QR Verification Complete/i)).toBeInTheDocument();
  });

  it('grades red ("Duplicate QR Codes Detected") when any plate has duplicate_qr, regardless of other statuses', () => {
    render(
      <QRVerificationBanner
        results={[
          plate({ status: 'duplicate_qr' }),
          plate({ plateIndex: '01', status: 'unreadable' }),
        ]}
      />
    );
    const banner = screen.getByTestId('qr-verification-banner');
    expect(screen.getByText(/Duplicate QR Codes Detected/i)).toBeInTheDocument();
    expect(banner.className).toContain('bg-red-50');
  });

  it('grades amber ("Some Plates Unreadable") for unreadable with no duplicate_qr', () => {
    render(<QRVerificationBanner results={[plate({ status: 'unreadable' })]} />);
    const banner = screen.getByTestId('qr-verification-banner');
    expect(screen.getByText(/Some Plates Unreadable/i)).toBeInTheDocument();
    expect(banner.className).toContain('bg-amber-50');
  });

  it('renders "Plate Mismatch Detected" for incorrect, distinct from the unreadable label', () => {
    render(<QRVerificationBanner results={[plate({ status: 'incorrect' })]} />);
    expect(screen.getByText(/Plate Mismatch Detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/Some Plates Unreadable/i)).not.toBeInTheDocument();
  });

  it('renders "Manual Review Needed" for needs_review', () => {
    render(<QRVerificationBanner results={[plate({ status: 'needs_review' })]} />);
    expect(screen.getByText(/Manual Review Needed/i)).toBeInTheDocument();
  });

  it('renders its own pinned "Verification Lookup Failed" title for lookup_failed, distinct from both "QR Unreadable" and "Manual Review Needed"', () => {
    render(<QRVerificationBanner results={[plate({ status: 'lookup_failed' })]} />);
    expect(screen.getByText(/Verification Lookup Failed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Some Plates Unreadable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Manual Review Needed/i)).not.toBeInTheDocument();
  });

  it('surfaces all applicable causes when two or more distinct non-green statuses co-occur with no duplicate_qr', () => {
    render(
      <QRVerificationBanner
        results={[
          plate({ status: 'unreadable' }),
          plate({ plateIndex: '01', status: 'lookup_failed' }),
        ]}
      />
    );
    expect(screen.getByText(/Some Plates Unreadable/i)).toBeInTheDocument();
    expect(screen.getByText(/Verification Lookup Failed/i)).toBeInTheDocument();
  });
});
