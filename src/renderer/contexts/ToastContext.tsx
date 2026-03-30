/**
 * Toast Notification Context
 *
 * Global toast notification system for errors, warnings, success, and info messages.
 * Usage:
 *   const { showToast, dismissToast } = useToast();
 *   showToast({ type: 'success', message: 'Saved!' });
 *   showToast({ type: 'error', message: 'Failed!' });
 *   showToast({ type: 'warning', message: '8 of 12 assigned', duration: 20000 });
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

export type ToastType = 'error' | 'warning' | 'success' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number | null; // null = manual dismiss only
}

interface ShowToastParams {
  type: ToastType;
  message: string;
  duration?: number; // ms, overrides default
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (params: ShowToastParams) => string;
  dismissToast: (id: string) => void;
}

const DEFAULT_DURATIONS: Record<ToastType, number | null> = {
  success: 8000,
  info: 8000,
  warning: 15000,
  error: null, // manual dismiss only
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (params: ShowToastParams): string => {
      const id = `toast-${++toastCounter}`;
      const duration =
        params.duration !== undefined
          ? params.duration
          : DEFAULT_DURATIONS[params.type];

      const toast: Toast = {
        id,
        type: params.type,
        message: params.message,
        duration,
      };

      setToasts((prev) => [toast, ...prev]); // newest on top

      if (duration !== null && duration > 0) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ─── Toast Container (renders all toasts) ─────────────────────────

const TOAST_STYLES: Record<
  ToastType,
  { bg: string; border: string; text: string; icon: string }
> = {
  error: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    icon: 'text-red-500',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    icon: 'text-amber-500',
  },
  success: {
    bg: 'bg-green-50',
    border: 'border-green-300',
    text: 'text-green-800',
    icon: 'text-green-500',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-800',
    icon: 'text-blue-500',
  },
};

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  error: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  ),
  success: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  ),
};

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-col gap-2 px-4 pt-4">
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type];
        return (
          <div
            key={toast.id}
            className={`${style.bg} ${style.border} border rounded-lg shadow-lg p-4 flex items-start gap-3 animate-slide-in`}
          >
            <div className={`flex-shrink-0 ${style.icon}`}>
              {TOAST_ICONS[toast.type]}
            </div>
            <p className={`${style.text} text-sm flex-1`}>{toast.message}</p>
            <button
              onClick={() => onDismiss(toast.id)}
              className={`flex-shrink-0 ${style.text} hover:opacity-70`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
