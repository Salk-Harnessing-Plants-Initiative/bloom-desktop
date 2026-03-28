import { describe, it, expect } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import {
  UploadStatusProvider,
  useUploadStatus,
} from '../../src/renderer/contexts/UploadStatusContext';

describe('UploadStatusContext', () => {
  it('should provide default idle state', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    expect(result.current.autoUploadStatus).toBe('idle');
    expect(result.current.autoUploadMessage).toBeNull();
    expect(result.current.boxBackupProgress).toBeNull();
  });

  it('should update upload status', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    act(() => {
      result.current.setAutoUploadStatus('uploading');
    });

    expect(result.current.autoUploadStatus).toBe('uploading');
  });

  it('should update upload message', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    act(() => {
      result.current.setAutoUploadMessage('Uploading 3 images...');
    });

    expect(result.current.autoUploadMessage).toBe('Uploading 3 images...');
  });

  it('should clear upload message with null', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    act(() => {
      result.current.setAutoUploadMessage('test');
    });
    expect(result.current.autoUploadMessage).toBe('test');

    act(() => {
      result.current.setAutoUploadMessage(null);
    });
    expect(result.current.autoUploadMessage).toBeNull();
  });

  it('should update box backup progress', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    act(() => {
      result.current.setBoxBackupProgress({
        totalImages: 10,
        completedImages: 3,
        failedImages: 0,
        currentExperiment: 'Test Experiment',
      });
    });

    expect(result.current.boxBackupProgress).toEqual({
      totalImages: 10,
      completedImages: 3,
      failedImages: 0,
      currentExperiment: 'Test Experiment',
    });
  });

  it('should transition through upload status states', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    // idle → waiting → uploading → done
    expect(result.current.autoUploadStatus).toBe('idle');

    act(() => result.current.setAutoUploadStatus('waiting'));
    expect(result.current.autoUploadStatus).toBe('waiting');

    act(() => result.current.setAutoUploadStatus('uploading'));
    expect(result.current.autoUploadStatus).toBe('uploading');

    act(() => result.current.setAutoUploadStatus('done'));
    expect(result.current.autoUploadStatus).toBe('done');
  });

  it('should transition to error state', () => {
    const { result } = renderHook(() => useUploadStatus(), {
      wrapper: UploadStatusProvider,
    });

    act(() => {
      result.current.setAutoUploadStatus('error');
      result.current.setAutoUploadMessage('Upload failed: network error');
    });

    expect(result.current.autoUploadStatus).toBe('error');
    expect(result.current.autoUploadMessage).toBe(
      'Upload failed: network error'
    );
  });

  it('should throw when used outside provider', () => {
    expect(() => {
      renderHook(() => useUploadStatus());
    }).toThrow('useUploadStatus must be used within an UploadStatusProvider');
  });

  it('should provide state to nested components', () => {
    function StatusDisplay() {
      const { autoUploadStatus } = useUploadStatus();
      return <div data-testid="status">{autoUploadStatus}</div>;
    }

    render(
      <UploadStatusProvider>
        <StatusDisplay />
      </UploadStatusProvider>
    );

    expect(screen.getByTestId('status').textContent).toBe('idle');
  });
});
