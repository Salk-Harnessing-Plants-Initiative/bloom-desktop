/**
 * Camera Streamer Component
 *
 * Displays live camera stream with automatic lifecycle management.
 * Uses React state + <img> tag for natural "latest frame wins" memory safety.
 * Automatically starts streaming on mount and stops on unmount.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { CameraSettings } from '../types/camera';

export interface StreamerProps {
  settings?: Partial<CameraSettings>;
  width?: number;
  height?: number;
  showFps?: boolean;
  onStreamStart?: () => void;
  onStreamStop?: () => void;
  onError?: (error: string) => void;
}

export const Streamer: React.FC<StreamerProps> = ({
  settings,
  width = 640,
  height = 480,
  showFps = true,
  onStreamStart,
  onStreamStop,
  onError,
}) => {
  const [currentFrame, setCurrentFrame] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());

  const updateFps = useCallback(() => {
    frameCountRef.current++;
    const now = Date.now();
    const elapsed = now - lastFpsUpdateRef.current;

    if (elapsed >= 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / elapsed));
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
  }, []);

  const handleFrame = useCallback(
    (image: { dataUri: string; timestamp: number }) => {
      setCurrentFrame(image.dataUri);
      updateFps();
    },
    [updateFps]
  );

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

    const removeFrameListener = window.electron.camera.onFrame(handleFrame);

    return () => {
      mounted = false;
      removeFrameListener();
      window.electron.camera.stopStream().then(() => {
        setIsStreaming(false);
        onStreamStop?.();
      });
    };
  }, [settings, handleFrame, onStreamStart, onStreamStop, onError]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {currentFrame ? (
        <img
          src={currentFrame}
          alt="Camera stream"
          style={{
            width,
            height,
            objectFit: 'contain',
            border: '1px solid #ccc',
            display: 'block',
            backgroundColor: '#000',
          }}
        />
      ) : (
        <div
          style={{
            width,
            height,
            border: '1px solid #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
          }}
        >
          <span style={{ color: '#fff', fontSize: '14px' }}>
            {error ? 'Error' : 'Connecting...'}
          </span>
        </div>
      )}

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
          {error ? 'Error' : isStreaming ? 'Streaming' : 'Waiting'}
        </span>
      </div>

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
