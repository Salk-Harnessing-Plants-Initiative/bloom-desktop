/**
 * Unit tests: ExperimentChooser color palette (Tier 4 style/UX parity)
 *
 * TDD: verifies the focus ring converts from blue to lime, while the
 * amber/gray border toggle (selected vs. empty state) is unchanged.
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
  it('uses focus:ring-lime-500 instead of focus:ring-blue-500', () => {
    render(<ExperimentChooser onExperimentChange={vi.fn()} />);

    const select = screen.getByRole('combobox');
    expect(select.className).toContain('focus:ring-lime-500');
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
