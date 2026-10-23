/**
 * Unit tests: MetadataForm clears wave number and plant age when the operator
 * moves from one experiment to another, or to none (#407), and keeps values
 * typed before the first experiment is chosen.
 * ExperimentChooser is replaced by a stub, so the test drives the experiment
 * change directly instead of going through the IPC-backed dropdown.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ScanMetadata } from '../../../src/components/MetadataForm';

vi.mock('../../../src/renderer/components/ExperimentChooser', () => ({
  ExperimentChooser: ({
    onExperimentChange,
  }: {
    onExperimentChange: (id: string | null) => void;
  }) => (
    <div>
      <button onClick={() => onExperimentChange('exp-A')}>choose A</button>
      <button onClick={() => onExperimentChange('exp-B')}>choose B</button>
      <button onClick={() => onExperimentChange(null)}>choose none</button>
    </div>
  ),
}));
vi.mock('../../../src/renderer/components/PhenotyperChooser', () => ({
  PhenotyperChooser: () => <div />,
}));
vi.mock('../../../src/components/PlantBarcodeInput', () => ({
  PlantBarcodeInput: () => <div />,
}));

import { MetadataForm } from '../../../src/components/MetadataForm';

const filled: ScanMetadata = {
  phenotyper: 'ph-1',
  experimentId: 'exp-A',
  waveNumber: '2',
  plantAgeDays: '12',
  plantQrCode: 'Daisy_1',
  accessionName: 'Daisy',
};

function renderForm(values: ScanMetadata = filled) {
  const onChange = vi.fn();
  render(<MetadataForm values={values} onChange={onChange} />);
  return onChange;
}

describe('MetadataForm experiment change (#407)', () => {
  it('clears wave number and plant age when a different experiment is chosen', () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByText('choose B'));
    expect(onChange).toHaveBeenCalledWith({
      ...filled,
      experimentId: 'exp-B',
      waveNumber: '',
      plantAgeDays: '',
      plantQrCode: '',
      accessionName: '',
    });
  });

  it('keeps wave number and plant age when the same experiment is chosen again', () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByText('choose A'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: 'exp-A',
        waveNumber: '2',
        plantAgeDays: '12',
        plantQrCode: '',
        accessionName: '',
      })
    );
  });

  it('clears wave number and plant age when "Choose an experiment" is picked', () => {
    const onChange = renderForm();
    fireEvent.click(screen.getByText('choose none'));
    expect(onChange).toHaveBeenCalledWith({
      ...filled,
      experimentId: '',
      waveNumber: '',
      plantAgeDays: '',
      plantQrCode: '',
      accessionName: '',
    });
  });

  it('keeps wave number and plant age typed before the first experiment is chosen', () => {
    const onChange = renderForm({ ...filled, experimentId: '' });
    fireEvent.click(screen.getByText('choose A'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentId: 'exp-A',
        waveNumber: '2',
        plantAgeDays: '12',
      })
    );
  });
});
