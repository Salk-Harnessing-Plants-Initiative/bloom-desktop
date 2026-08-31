/**
 * Unit tests: ExperimentChooser color palette (Tier 4 style/UX parity)
 *
 * TDD: verifies the focus ring converts from blue to lime, while the
 * amber/gray border toggle (selected vs. empty state) is unchanged.
 *
 * lime-700, not lime-500: PR #329's own design.md flagged the ring color
 * as "novel, not attested in the pilot" and left its visual/contrast
 * check unverified. lime-500 on white computes to ~1.98:1 contrast,
 * failing WCAG 2.1 SC 1.4.11's 3:1 minimum for focus indicators (the
 * blue-500 it replaced was ~3.68:1). lime-700 (~5:1) keeps the lime
 * accent while actually meeting that bar — found and fixed during
 * add-graviscan-capture-scan-screen's round-3 /review-pr, since this
 * component is shared with GraviScan's Capture Scan screen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExperimentChooser } from '../../../src/renderer/components/ExperimentChooser';

const mockList = vi.fn().mockResolvedValue({ success: true, data: [] });

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ success: true, data: [] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron?.database,
      experiments: { list: mockList },
    },
  };
});

describe('ExperimentChooser color palette', () => {
  it('uses focus:ring-lime-700 instead of focus:ring-blue-500 (lime-700, not -500, for WCAG contrast)', () => {
    render(<ExperimentChooser onExperimentChange={vi.fn()} />);

    const select = screen.getByRole('combobox');
    expect(select.className).toContain('focus:ring-lime-700');
    expect(select.className).not.toContain('focus:ring-lime-500');
    expect(select.className).not.toContain('focus:ring-blue-500');
  });

  it('keeps the amber/gray border toggle unchanged (regression guard)', () => {
    const { rerender } = render(
      <ExperimentChooser onExperimentChange={vi.fn()} value={null} />
    );
    expect(screen.getByRole('combobox').className).toContain(
      'border-amber-300'
    );

    rerender(<ExperimentChooser onExperimentChange={vi.fn()} value="exp-1" />);
    expect(screen.getByRole('combobox').className).toContain('border-gray-300');
  });
});
