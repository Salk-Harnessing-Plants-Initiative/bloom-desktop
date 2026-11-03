/**
 * Shown instead of the app when ~/.bloom/.env exists but couldn't be read at start-up
 * (#485): a locked or damaged file is not a new station, so first-run setup, and a save
 * that would write over the real settings, stay out of reach until Retry reads it.
 */

import { StationConfigNotice } from './StationConfigNotice';

export interface StationSettingsUnreadableProps {
  loadError: string;
  onRetry: () => Promise<void>;
}

export function StationSettingsUnreadable({
  loadError,
  onRetry,
}: StationSettingsUnreadableProps) {
  return (
    <div
      className="flex h-screen items-center justify-center bg-gray-50 p-8"
      data-testid="station-settings-unreadable"
    >
      <div className="max-w-xl">
        <StationConfigNotice
          title="Bloom Desktop can't start yet"
          problem={`${loadError}. The settings haven't been changed. Press Retry to read them again.`}
          onRetry={onRetry}
          showMachineConfigLink={false}
        />
      </div>
    </div>
  );
}
