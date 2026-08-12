import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizableColumns } from '../../../src/renderer/hooks/useResizableColumns';

function fireMouseMove(clientX: number) {
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX }));
  });
}

function fireMouseUp() {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup'));
  });
}

describe('useResizableColumns', () => {
  const initialWidths = { name: 100, date: 80 };

  it('returns the initial widths', () => {
    const { result } = renderHook(() => useResizableColumns(initialWidths));
    expect(result.current.widths).toEqual(initialWidths);
  });

  it('updates only the dragged column width on mousemove after onResizeStart', () => {
    const { result } = renderHook(() => useResizableColumns(initialWidths));

    act(() => {
      result.current.onResizeStart('name')({
        clientX: 0,
      } as unknown as React.MouseEvent);
    });
    fireMouseMove(50);

    expect(result.current.widths.name).toBe(150);
    expect(result.current.widths.date).toBe(80);
  });

  it('stops updating widths after mouseup', () => {
    const { result } = renderHook(() => useResizableColumns(initialWidths));

    act(() => {
      result.current.onResizeStart('name')({
        clientX: 0,
      } as unknown as React.MouseEvent);
    });
    fireMouseMove(50);
    fireMouseUp();
    fireMouseMove(200);

    expect(result.current.widths.name).toBe(150);
  });

  it('removes mousemove/mouseup listeners on unmount mid-drag, without throwing', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() =>
      useResizableColumns(initialWidths)
    );

    act(() => {
      result.current.onResizeStart('name')({
        clientX: 0,
      } as unknown as React.MouseEvent);
    });

    expect(() => unmount()).not.toThrow();
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    removeSpy.mockRestore();
  });
});
