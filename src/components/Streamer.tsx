/**
 * Camera Streamer Component
 *
 * Displays live camera stream with automatic lifecycle management.
 * Uses canvas + Blob URL rendering with explicit revocation to prevent
 * Chromium's data-URI bitmap cache leak (Chromium issue 41067124).
 * Automatically starts streaming on mount and stops on unmount.
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
   * Width of the display area in pixels
   * @default 640
   */
  width?: number;

  /**
   * Height of the display area in pixels
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

export const Streamer: React.FC<StreamerProps> = ({
  settings,
  width = 640,
  height = 480,
  showFps = true,
  onStreamStart,
  onStreamStop,
  onError,
}) => {
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDecodingRef = useRef(false);
  const pendingFrameRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

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

  const decodeAndDraw = useCallback(
    (dataUri: string) => {
      if (!mountedRef.current) return;
      isDecodingRef.current = true;

      try {
        // Decode base64 data URI to binary
        const base64 = dataUri.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/jpeg' });

        // createImageBitmap decodes the image; bitmap.close() frees C++ memory
        createImageBitmap(blob).then(
          (bitmap) => {
            // Always close the bitmap to free C++ memory, even if unmounted
            const canvas = canvasRef.current;
            if (mountedRef.current && canvas) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                // clearRect clears to transparent — CSS background provides black letterbox bars
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Aspect-ratio-preserving letterbox using bitmap dimensions
                const scale = Math.min(
                  canvas.width / bitmap.width,
                  canvas.height / bitmap.height
                );
                const drawWidth = bitmap.width * scale;
                const drawHeight = bitmap.height * scale;
                const x = (canvas.width - drawWidth) / 2;
                const y = (canvas.height - drawHeight) / 2;

                ctx.drawImage(bitmap, x, y, drawWidth, drawHeight);
              }

              if (!hasFirstFrame) {
                setHasFirstFrame(true);
              }
              updateFps();
            }

            // Free C++ bitmap memory — the only API that deterministically releases it
            bitmap.close();

            isDecodingRef.current = false;

            // Drain pending frame (latest-frame-wins)
            if (pendingFrameRef.current && mountedRef.current) {
              const next = pendingFrameRef.current;
              pendingFrameRef.current = null;
              decodeAndDraw(next);
            }
          },
          () => {
            // createImageBitmap rejected (corrupt image data)
            isDecodingRef.current = false;
            if (pendingFrameRef.current && mountedRef.current) {
              const next = pendingFrameRef.current;
              pendingFrameRef.current = null;
              decodeAndDraw(next);
            }
          }
        );
      } catch {
        // atob() or Blob construction failed
        isDecodingRef.current = false;
        if (pendingFrameRef.current && mountedRef.current) {
          const next = pendingFrameRef.current;
          pendingFrameRef.current = null;
          decodeAndDraw(next);
        }
      }
    },
    [hasFirstFrame, updateFps]
  );

  // Handle incoming frames — busy gate with latest-frame-wins
  const handleFrame = useCallback(
    (image: { dataUri: string; timestamp: number }) => {
      if (!image.dataUri) return;

      if (isDecodingRef.current) {
        // Gate closed — buffer latest frame (overwrites previous)
        pendingFrameRef.current = image.dataUri;
        return;
      }

      decodeAndDraw(image.dataUri);
    },
    [decodeAndDraw]
  );

  // Start streaming on mount
  useEffect(() => {
    mountedRef.current = true;

    const startStreaming = async () => {
      try {
        const response = await window.electron.camera.startStream(settings);

        if (!mountedRef.current) return;

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
        if (!mountedRef.current) return;

        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        onError?.(errorMsg);
      }
    };

    startStreaming();

    const removeFrameListener = window.electron.camera.onFrame(handleFrame);

    return () => {
      // Ordered cleanup: mountedRef first, then pending, then listener, then stream
      // Any in-flight createImageBitmap will see mountedRef=false and skip drawing
      // but still call bitmap.close() to free memory
      mountedRef.current = false;
      pendingFrameRef.current = null;

      removeFrameListener();
      window.electron.camera.stopStream().catch(() => {
        // Ignore errors during cleanup — component is unmounting
      });
    };
  }, [settings, handleFrame, onStreamStart, onStreamStop, onError]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Canvas is always in the DOM so ref is available for first draw.
          Hidden until first frame via display:none, then shown. */}
      <canvas
        ref={canvasRef}
        data-testid="stream-canvas"
        width={width}
        height={height}
        style={{
          border: '1px solid #ccc',
          display: hasFirstFrame ? 'block' : 'none',
          backgroundColor: '#000',
        }}
      />
      {!hasFirstFrame && (
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
          {error ? 'Error' : isStreaming ? 'Streaming' : 'Connecting...'}
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
