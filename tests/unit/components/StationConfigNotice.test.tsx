import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { StationConfigNotice } from '../../../src/renderer/components/StationConfigNotice';
import { StationSettingsUnreadable } from '../../../src/renderer/components/StationSettingsUnreadable';

describe('StationConfigNotice (#477, #485)', () => {
  it('shows the problem, Retry and the Machine Configuration link', () => {
    render(
      <MemoryRouter>
        <StationConfigNotice problem="No scanner name." onRetry={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByText('No scanner name.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open Machine Configuration' })
    ).toHaveAttribute('href', '/machine-config');
    expect(
      screen.queryByTestId('station-config-contact')
    ).not.toBeInTheDocument();
  });

  it('says to contact the Bloom team when Retry does not fix it', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <StationConfigNotice problem="EBUSY" onRetry={onRetry} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('station-config-contact')).toHaveTextContent(
      "Retry didn't fix it. If this keeps happening, contact the Bloom team."
    );
  });

  it('also says so when Retry itself fails', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('IPC gone'));
    render(
      <MemoryRouter>
        <StationConfigNotice problem="EBUSY" onRetry={onRetry} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(screen.getByTestId('station-config-contact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});

describe('StationSettingsUnreadable (#485)', () => {
  it('explains the settings were not changed, with Retry and no way to Machine Configuration', () => {
    render(
      <StationSettingsUnreadable
        loadError="Couldn't read this station's settings file (C:\\Users\\x\\.bloom\\.env): EBUSY"
        onRetry={vi.fn()}
      />
    );
    expect(
      screen.getByText("Bloom Desktop can't start yet")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/EBUSY\. The settings haven't been changed\./)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
