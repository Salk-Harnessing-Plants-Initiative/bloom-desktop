// @vitest-environment happy-dom
/**
 * Task 10 (#235): Cadence warning banner renders when the predicted
 * cycle wall time exceeds the configured interval; hides otherwise;
 * reacts to DPI / platesPerScanner changes.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CadenceWarningBanner } from '../../src/renderer/components/graviscan/CadenceWarningBanner';

describe('CadenceWarningBanner', () => {
  it('renders banner when 4-plate × 1200 dpi exceeds 5-min interval', () => {
    const { queryByTestId } = render(
      <CadenceWarningBanner
        platesPerScanner={4}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    expect(queryByTestId('cadence-warning-banner')).toBeTruthy();
  });

  it('does NOT render when 2-plate × 1200 dpi fits 5-min interval', () => {
    const { queryByTestId } = render(
      <CadenceWarningBanner
        platesPerScanner={2}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    expect(queryByTestId('cadence-warning-banner')).toBeNull();
  });

  it('disappears when DPI drops from 1200 to 600 (fits interval)', () => {
    const { queryByTestId, rerender } = render(
      <CadenceWarningBanner
        platesPerScanner={4}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    expect(queryByTestId('cadence-warning-banner')).toBeTruthy();
    rerender(
      <CadenceWarningBanner
        platesPerScanner={4}
        scannerCount={5}
        dpi={600}
        intervalMinutes={5}
      />
    );
    // 4 plates × (600/1200) × 102 s = 204 s ≤ 300 s ⇒ banner hidden
    expect(queryByTestId('cadence-warning-banner')).toBeNull();
  });

  it('disappears when platesPerScanner drops from 4 to 2 (fits interval)', () => {
    const { queryByTestId, rerender } = render(
      <CadenceWarningBanner
        platesPerScanner={4}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    expect(queryByTestId('cadence-warning-banner')).toBeTruthy();
    rerender(
      <CadenceWarningBanner
        platesPerScanner={2}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    expect(queryByTestId('cadence-warning-banner')).toBeNull();
  });

  it('mentions remediation options when shown', () => {
    const { container } = render(
      <CadenceWarningBanner
        platesPerScanner={4}
        scannerCount={5}
        dpi={1200}
        intervalMinutes={5}
      />
    );
    const txt = container.textContent ?? '';
    expect(txt).toContain('2-grid');
    expect(txt).toContain('lower the DPI');
    // "Shorten the scan region" was removed — there is no UI control
    // for it. The banner only suggests options the operator can act
    // on from the UI.
    expect(txt).not.toContain('shorten');
  });
});
