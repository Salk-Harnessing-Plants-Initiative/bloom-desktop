/**
 * WholeNumberInput: a box that only accepts a whole number (0 or more), used for
 * Wave Number and Plant Age on the Capture Scan page.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';
import { WholeNumberInput } from '../../../src/components/WholeNumberInput';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="waveNumber">Wave Number</label>
      <WholeNumberInput id="waveNumber" value={value} onChange={setValue} />
    </>
  );
}

const box = () => screen.getByRole('textbox') as HTMLInputElement;
const HINT = 'Whole numbers only (0 or more)';

afterEach(() => {
  vi.useRealTimers();
});

describe('WholeNumberInput', () => {
  it.each(['0', '7', '12', '07'])('accepts %s', (typed) => {
    render(<Harness />);
    fireEvent.change(box(), { target: { value: typed } });
    expect(box()).toHaveValue(typed);
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('allows clearing the box', () => {
    render(<Harness initial="5" />);
    fireEvent.change(box(), { target: { value: '' } });
    expect(box()).toHaveValue('');
  });

  it.each(['abc', '1a', '-1', '1.5', '14.5', '3 4', ' 5'])(
    'rejects %s, keeps the previous value and says why',
    (typed) => {
      render(<Harness initial="7" />);
      fireEvent.change(box(), { target: { value: typed } });
      expect(box()).toHaveValue('7');
      expect(screen.getByText(HINT)).toBeVisible();
    }
  );

  it('hides the hint again after a few seconds', () => {
    vi.useFakeTimers();
    render(<Harness initial="7" />);
    fireEvent.change(box(), { target: { value: 'x' } });
    expect(screen.getByText(HINT)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('hides the hint as soon as a valid value is typed', () => {
    render(<Harness initial="7" />);
    fireEvent.change(box(), { target: { value: 'x' } });
    fireEvent.change(box(), { target: { value: '8' } });
    expect(box()).toHaveValue('8');
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('keeps the id so the label and existing tests find the box', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Wave Number')).toBe(box());
    expect(box().id).toBe('waveNumber');
  });
});
