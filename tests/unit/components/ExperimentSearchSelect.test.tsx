/**
 * Unit tests: ExperimentSearchSelect (#471), the searchable experiment picker.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ExperimentSearchSelect } from '../../../src/components/ExperimentSearchSelect';

const EXPERIMENTS = [
  { id: 'alf', label: 'Alfalfa - Alfalfa-wave3' },
  { id: 'kcs', label: 'Soybean - KCS-drought-2026' },
  { id: 'weep', label: 'Arabidopsis - weep6-MBZ-Interaction-EXP1' },
];

function renderSelect(value = '') {
  const onChange = vi.fn();
  render(
    <ExperimentSearchSelect
      experiments={EXPERIMENTS}
      value={value}
      onChange={onChange}
      noneLabel="All Experiments"
    />
  );
  return { onChange, input: screen.getByRole('combobox') };
}

const shown = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('ExperimentSearchSelect', () => {
  it('shows the chosen experiment, or All Experiments for none', () => {
    renderSelect('kcs');
    expect(screen.getByRole('combobox')).toHaveValue(
      'Soybean - KCS-drought-2026'
    );
  });

  it('narrows the list to names containing what is typed, ignoring case', async () => {
    const user = userEvent.setup();
    const { input } = renderSelect();
    await user.type(input, 'mbz');
    expect(shown()).toEqual([
      'All Experiments',
      'Arabidopsis - weep6-MBZ-Interaction-EXP1',
    ]);
  });

  it('picks with the mouse', async () => {
    const user = userEvent.setup();
    const { input, onChange } = renderSelect();
    await user.click(input);
    await user.click(screen.getByRole('option', { name: /KCS-drought/ }));
    expect(onChange).toHaveBeenCalledWith('kcs');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picks the first match with Enter after typing, and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    const { input, onChange } = renderSelect();
    await user.type(input, 'a');
    await user.keyboard('{Enter}');
    // "a" matches all three; the first match, not All Experiments, is picked.
    expect(onChange).toHaveBeenLastCalledWith('alf');

    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('kcs');
  });

  it('clears the filter with All Experiments', async () => {
    const user = userEvent.setup();
    const { input, onChange } = renderSelect('kcs');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'All Experiments' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('closes unchanged with Escape', async () => {
    const user = userEvent.setup();
    const { input, onChange } = renderSelect('kcs');
    await user.type(input, 'alf');
    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('Soybean - KCS-drought-2026');
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    const { input } = renderSelect();
    await user.type(input, 'nothing');
    expect(
      screen.getByText('No experiments match “nothing”')
    ).toBeInTheDocument();
  });
});
