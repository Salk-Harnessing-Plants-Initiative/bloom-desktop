/**
 * ScanProgress Component
 *
 * Displays real-time scanning progress with frame count and progress bar.
 */

import { useEffect, useState } from 'react';

export interface ScanProgressProps {
  /** Current frame number (0-indexed) */
  currentFrame: number;
  /** Total number of frames to capture */
  totalFrames: number;
  /** Optional callback to cancel the scan */
  onCancel?: () => void;
}

export function ScanProgress({
  currentFrame,
  totalFrames,
  onCancel,
}: ScanProgressProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Timer for elapsed time
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // currentFrame is 0-indexed, but represents the frame just captured
  // So currentFrame=0 means 1 frame completed, currentFrame=71 means 72 frames completed
  const progress =
    totalFrames > 0 ? ((currentFrame + 1) / totalFrames) * 100 : 0;
  // Calculate ETA based on completed frames (currentFrame + 1)
  const completedFrames = currentFrame + 1;
  const estimatedTotalTime =
    currentFrame >= 0 && completedFrames > 0
      ? (elapsedSeconds / completedFrames) * totalFrames
      : 0;
  const estimatedRemainingTime = Math.max(
    0,
    estimatedTotalTime - elapsedSeconds
  );

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white border-2 border-blue-500 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Scanning...</h3>
        <div className="flex items-center space-x-2">
          {/* Spinner */}
          <svg
            className="animate-spin h-5 w-5 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm text-gray-600">
            Elapsed: {formatTime(elapsedSeconds)}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>
            Frame {currentFrame + 1} of {totalFrames}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
          <div
            className="bg-blue-600 h-full transition-all duration-300 ease-out rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* ETA */}
      {currentFrame > 0 && (
        <div className="text-sm text-gray-600">
          <p>Estimated time remaining: {formatTime(estimatedRemainingTime)}</p>
        </div>
      )}

      {/* Cancel Button */}
      {onCancel && (
        <div className="pt-2">
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium transition-colors"
          >
            Cancel Scan
          </button>
        </div>
      )}
    </div>
  );
}
