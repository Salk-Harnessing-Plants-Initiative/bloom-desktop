import { useCallback, useEffect, useRef, useState } from 'react';

type ColumnWidths = Record<string, number>;

interface DragState {
  column: string;
  startX: number;
  startWidths: ColumnWidths;
}

/**
 * Shared drag-to-resize logic for a set of named columns, replacing the
 * imperative document.addEventListener('mousemove'/'mouseup') pattern
 * duplicated across the production branch's file tables/panels.
 */
export function useResizableColumns(initialWidths: ColumnWidths) {
  const [widths, setWidths] = useState<ColumnWidths>(initialWidths);
  const dragRef = useRef<DragState | null>(null);

  const onMouseMove = useCallback((event: MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    setWidths({
      ...drag.startWidths,
      [drag.column]: drag.startWidths[drag.column] + delta,
    });
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  const onResizeStart = useCallback(
    (column: string) => (event: React.MouseEvent) => {
      dragRef.current = {
        column,
        startX: event.clientX,
        startWidths: widths,
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [widths, onMouseMove, onMouseUp]
  );

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  return { widths, onResizeStart };
}
