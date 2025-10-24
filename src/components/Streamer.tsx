/**
 * Camera Streamer Component
 *
 * Displays live camera stream with automatic lifecycle management.
 * Automatically starts streaming on mount and stops on unmount.
 * Displays FPS counter and connection status.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { CameraSettings } from '../types/camera';

export interface StreamerProps {
  /**
   * Camera settings for streaming
   * Optional - will use camera's current settings if not provided
   */
  settings?: Partial<CameraSettings>;

  /**
   * Width of the display canvas in pixels
   * @default 640
   */
  width?: number;

  /**
   * Height of the display canvas in pixels
   * @default 480
   */
  height?: number;

  /**
   * Whether to show FPS counter
   * @default true
   */
  showFps?: boolean;

  /**
   * Callback when streaming starts successfully
   */
  onStreamStart?: () => void;

  /**
   * Callback when streaming stops
   */
  onStreamStop?: () => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: string) => void;
}

/**
 * Streamer component for live camera preview
 */
export const Streamer: React.FC<StreamerProps> = ({
  settings,
  width = 640,
  height = 480,
  showFps = true,
  onStreamStart,
  onStreamStop,
  onError,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // FPS calculation
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  const updateFps = useCallback(() => {
    frameCountRef.current++;
    const now = Date.now();
    const elapsed = now - lastFpsUpdateRef.current;

    // Update FPS every second
    if (elapsed >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / elapsed));
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
  }, []);

  // Handle incoming frames
  const handleFrame = useCallback(
    (image: { dataUri: string; timestamp: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Create image and draw to canvas
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        updateFps();
      };
      img.onerror = () => {
        // Suppress console errors for invalid data URIs (cosmetic issue)
        // The browser console shows ERR_INVALID_URL when displaying base64 data
      };
      img.src = image.dataUri;
    },
    [updateFps]
  );

  // Start streaming on mount
  useEffect(() => {
    let mounted = true;

    const startStreaming = async () => {
      try {
        const response = await window.electron.camera.startStream(settings);

        if (!mounted) return;

        if (response.success) {
          setIsStreaming(true);
          setError(null);
          onStreamStart?.();
        } else {
          const errorMsg = response.error || 'Failed to start streaming';
          setError(errorMsg);
          onError?.(errorMsg);
        }
      } catch (err) {
        if (!mounted) return;

        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        onError?.(errorMsg);
      }
    };

    startStreaming();

    // Register frame callback and get cleanup function
    const removeFrameListener = window.electron.camera.onFrame(handleFrame);

    // Cleanup: stop streaming and remove listener on unmount
    return () => {
      mounted = false;
      removeFrameListener(); // Remove frame listener to prevent memory leak
      window.electron.camera.stopStream().then(() => {
        setIsStreaming(false);
        onStreamStop?.();
      });
    };
  }, [settings, handleFrame, onStreamStart, onStreamStop, onError]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: '1px solid #ccc',
          display: 'block',
          backgroundColor: '#000',
        }}
      />

      {/* FPS Counter */}
      {showFps && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        >
          {fps} FPS
        </div>
      )}

      {/* Status Indicator */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: error
              ? '#f44336'
              : isStreaming
                ? '#4caf50'
                : '#ff9800',
            marginRight: '6px',
          }}
        />
        <span style={{ color: '#fff' }}>
          {error ? 'Error' : isStreaming ? 'Streaming' : 'Connecting...'}
        </span>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            right: '8px',
            backgroundColor: 'rgba(244, 67, 54, 0.9)',
            color: '#fff',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};
