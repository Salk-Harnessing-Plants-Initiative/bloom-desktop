import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  CameraSettingsCheckPanel,
  PREVIEW_DELAY_MS,
  changedTodayText,
} from '../../../src/renderer/components/CameraSettingsCheckPanel';
import type {
  CameraSettingsReference,
  ExperimentCameraSettingsInfo,
  ExperimentCameraSettingsStatus,
} from '../../../src/types/experiment-camera-settings';
import { pathToFileUrl } from '../../../src/utils/file-url';

const current: ExperimentCameraSettingsInfo = {
  id: 'r2',
  exposure_time: 7400,
  gain: 250,
  gamma: 1,
  note: 'Roots too dark',
  set_by_name: 'Ana',
  created_at: new Date(2026, 10, 3, 10, 15).toISOString(),
  last_confirmed_at: new Date(2026, 10, 3, 10, 15).toISOString(),
  last_confirmed_by_name: 'Ana',
};

const status = (
  extra: Partial<ExperimentCameraSettingsStatus> = {}
): ExperimentCameraSettingsStatus => ({
  current,
  confirmedToday: false,
  changedToday: null,
  ...extra,
});

const line = (
  exposure_time: number,
  scan_count: number,
  extra: Partial<CameraSettingsReference> = {}
): CameraSettingsReference => ({
  exposure_time,
  gain: 250,
  gamma: 1,
  scan_count,
  first_captured: new Date(2026, 9, 8, 10).toISOString(),
  last_captured: new Date(2026, 9, 19, 10).toISOString(),
  latest_image_path: `kcs/${exposure_time}/frame_1.png`,
  is_current: false,
  ...extra,
});

function renderPanel(
  props: Partial<React.ComponentProps<typeof CameraSettingsCheckPanel>> = {}
) {
  const onConfirm = vi.fn(async () => null as string | null);
  const onPreview = vi.fn();
  render(
    <CameraSettingsCheckPanel
      experimentName="KCS"
      status={status()}
      reference={[]}
      scansDir="/scans"
      onPreview={onPreview}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onConfirm, onPreview, ...props };
}

const numberBoxes = () =>
  screen.getAllByRole('spinbutton') as HTMLInputElement[];
const confirmButton = () =>
  screen.getByRole('button', { name: 'Confirm and continue' });
const noteBox = () => screen.getByRole('textbox');

afterEach(() => {
  vi.useRealTimers();
});

describe('CameraSettingsCheckPanel', () => {
  it("starts at the experiment's current settings", () => {
    renderPanel();
    expect(screen.getByText('Set camera settings for KCS')).toBeInTheDocument();
    expect(numberBoxes().map((b) => b.value)).toEqual(['7400', '250', '1']);
  });

  it('starts a new experiment at 10000 / 100 / 1, with an optional note and an empty list', () => {
    renderPanel({ status: status({ current: null }) });
    expect(numberBoxes().map((b) => b.value)).toEqual(['10000', '100', '1']);
    expect(screen.getByText(/no camera settings yet/)).toBeInTheDocument();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    expect(screen.getByText(/first setting/)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('confirms unchanged values without a note', async () => {
    const { onConfirm } = renderPanel();
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        { exposure_time: 7400, gain: 250, gamma: 1 },
        ''
      )
    );
  });

  it('needs a note once the values change, and sends it trimmed', async () => {
    const { onConfirm } = renderPanel();
    fireEvent.change(numberBoxes()[0], { target: { value: '7900' } });
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(/add a note saying why/)).toBeInTheDocument();

    fireEvent.change(noteBox(), { target: { value: '   ' } });
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(noteBox(), { target: { value: '  Roots too dark  ' } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        { exposure_time: 7900, gain: 250, gamma: 1 },
        'Roots too dark'
      )
    );
  });

  it("can't confirm values outside the limits", () => {
    renderPanel();
    fireEvent.change(numberBoxes()[1], { target: { value: '600' } });
    fireEvent.change(noteBox(), { target: { value: 'brighter' } });
    expect(confirmButton()).toBeDisabled();
  });

  it('lists the settings used before, and fills them in when one is clicked', () => {
    renderPanel({
      reference: [
        line(7400, 112, { is_current: true }),
        line(7300, 48),
        line(7900, 0, {
          first_captured: null,
          last_captured: null,
          latest_image_path: null,
        }),
      ],
    });
    const lines = screen.getAllByTestId('camera-reference-line');
    expect(lines.map((l) => l.textContent)).toEqual([
      expect.stringMatching(
        /7,400 µs · gain 250 · gamma 1\.0current112 scans · Oct 8, 2026 – Oct 19, 2026/
      ),
      expect.stringMatching(/7,300 µs.*48 scans/),
      expect.stringMatching(/7,900 µs.*saved, not used yet/),
    ]);
    expect(
      screen.getByAltText('Latest scan at 7,300 µs · gain 250 · gamma 1.0')
    ).toHaveAttribute('src', pathToFileUrl('/scans/kcs/7300/frame_1.png'));

    fireEvent.click(lines[1]);
    expect(numberBoxes().map((b) => b.value)).toEqual(['7300', '250', '1']);
    expect(confirmButton()).toBeDisabled();
  });

  it('shows a single day once when a setting was used on one day', () => {
    renderPanel({
      reference: [
        line(7400, 1, {
          first_captured: new Date(2026, 9, 20, 9).toISOString(),
          last_captured: new Date(2026, 9, 20, 15).toISOString(),
        }),
      ],
    });
    expect(screen.getByTestId('camera-reference-line')).toHaveTextContent(
      /1 scan · Oct 20, 2026$/
    );
  });

  it('shows N/A when a thumbnail fails to load', () => {
    renderPanel({ reference: [line(7400, 3)] });
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('says who changed the settings today and why', () => {
    renderPanel({
      status: status({
        changedToday: {
          by_name: 'Ana',
          at: new Date(2026, 10, 3, 10, 15).toISOString(),
          from: { exposure_time: 7300, gain: 250, gamma: 1 },
          to: { exposure_time: 7400, gain: 250, gamma: 1 },
          note: 'Roots too dark',
        },
      }),
    });
    expect(screen.getByTestId('camera-changed-today')).toHaveTextContent(
      /^Changed today at 10:15 AM by Ana: 7,300 → 7,400 µs\. Roots too dark$/
    );
  });

  it('shows the error from saving, and stays open', async () => {
    const onConfirm = vi.fn(
      async () => "This experiment's camera settings were just changed."
    );
    renderPanel({ onConfirm });
    fireEvent.click(confirmButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'were just changed'
    );
    expect(confirmButton()).toBeEnabled();
  });

  it('updates the preview only once the values stop changing', () => {
    vi.useFakeTimers();
    const { onPreview } = renderPanel();
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    });
    expect(onPreview).toHaveBeenLastCalledWith({
      exposure_time: 7400,
      gain: 250,
      gamma: 1,
    });
    onPreview.mockClear();

    fireEvent.change(numberBoxes()[0], { target: { value: '7500' } });
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DELAY_MS - 100);
    });
    fireEvent.change(numberBoxes()[0], { target: { value: '7600' } });
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    });
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith({
      exposure_time: 7600,
      gain: 250,
      gamma: 1,
    });
  });

  it("doesn't preview values outside the limits", () => {
    vi.useFakeTimers();
    const { onPreview } = renderPanel();
    fireEvent.change(numberBoxes()[1], { target: { value: '600' } });
    onPreview.mockClear();
    act(() => {
      vi.advanceTimersByTime(PREVIEW_DELAY_MS * 2);
    });
    expect(onPreview).not.toHaveBeenCalled();
  });
});

describe('changedTodayText', () => {
  const base = {
    by_name: 'Ana',
    at: new Date(2026, 10, 3, 14, 5).toISOString(),
    note: 'New lens',
  };

  it('lists each value that changed', () => {
    expect(
      changedTodayText({
        ...base,
        from: { exposure_time: 7000, gain: 100, gamma: 1 },
        to: { exposure_time: 7000, gain: 250, gamma: 1.2 },
      })
    ).toBe(
      'Changed today at 02:05 PM by Ana: gain 100 → 250, gamma 1.0 → 1.2. New lens'
    );
  });

  it("describes an experiment's first settings", () => {
    expect(
      changedTodayText({
        ...base,
        from: null,
        to: { exposure_time: 8800, gain: 250, gamma: 1 },
      })
    ).toBe(
      'Changed today at 02:05 PM by Ana: set to 8,800 µs · gain 250 · gamma 1.0. New lens'
    );
  });
});
