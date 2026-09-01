/**
 * Unit tests for Layout — mode-conditional nav links
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '../../../src/renderer/Layout';
import { UploadStatusProvider } from '../../../src/renderer/contexts/UploadStatusContext';
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from '../../../src/renderer/contexts/UnsavedChangesContext';
import type { GraviWedgeEvent } from '../../../src/types/graviscan';

/** Stands in for GraviMetadataUpload.tsx signaling in-progress, unsaved
 * work — and clearing it on unmount, exactly as the real component must. */
function FakeUnsavedMetadataPage() {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  useEffect(() => {
    setHasUnsavedChanges(true);
    return () => setHasUnsavedChanges(false);
  }, [setHasUnsavedChanges]);
  return <div>Metadata content</div>;
}

/** Stands in for GraviMetadataUpload.tsx while its createWithSections IPC
 * call is actually in flight — a stronger signal than "has unsaved
 * changes" (see UnsavedChangesContext.tsx's blockNavigation doc comment). */
function FakeImportingMetadataPage() {
  const { setBlockNavigation } = useUnsavedChanges();
  useEffect(() => {
    setBlockNavigation(true);
    return () => setBlockNavigation(false);
  }, [setBlockNavigation]);
  return <div>Metadata content</div>;
}

let wedgeListeners: Array<(event: GraviWedgeEvent) => void>;
let uploadProgressListeners: Array<(data: unknown) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  wedgeListeners = [];
  uploadProgressListeners = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      scanner: {
        getScannerId: vi.fn().mockResolvedValue('TestScanner'),
      },
      // Wedge-response UI (Tier 3) mocks — without these, WedgeBanner
      // mounting unconditionally in graviscan mode throws
      // TypeError: Cannot read properties of undefined (reading
      // 'onWedgeDetected') against this file's otherwise-bare mock.
      gravi: {
        onWedgeDetected: vi.fn((cb: (event: GraviWedgeEvent) => void) => {
          wedgeListeners.push(cb);
          return () => {};
        }),
        onIntervalComplete: vi.fn(() => () => {}),
        onCancelled: vi.fn(() => () => {}),
        retryScanner: vi.fn().mockResolvedValue({ success: true }),
        onUploadProgress: vi.fn((cb: (data: unknown) => void) => {
          uploadProgressListeners.push(cb);
          return () => {};
        }),
      },
    };
  }
});

function fireUploadProgress(data: unknown) {
  act(() => {
    uploadProgressListeners.forEach((cb) => cb(data));
  });
}

function renderLayout(mode: string | null, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <UploadStatusProvider>
        <UnsavedChangesProvider>
          <Routes>
            <Route path="/" element={<Layout mode={mode} />}>
              <Route index element={<div>Home content</div>} />
              <Route
                path="configure-scanner"
                element={<div>Configure Scanner content</div>}
              />
              <Route path="metadata" element={<FakeUnsavedMetadataPage />} />
              <Route
                path="metadata-importing"
                element={<FakeImportingMetadataPage />}
              />
              <Route path="*" element={<div>Other content</div>} />
            </Route>
          </Routes>
        </UnsavedChangesProvider>
      </UploadStatusProvider>
    </MemoryRouter>
  );
}

describe('Layout nav links', () => {
  it('renders a "Configure Scanner" nav link pointing to /configure-scanner in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const link = screen.getByRole('link', { name: /configure scanner/i });
    expect(link).toHaveAttribute('href', '/configure-scanner');
  });

  it('does not render a "Configure Scanner" nav link in cylinderscan mode', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    expect(
      screen.queryByRole('link', { name: /configure scanner/i })
    ).not.toBeInTheDocument();
  });

  it('renders a "Capture Scan" nav link pointing to /capture-scan in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const link = screen.getByRole('link', { name: /^capture scan$/i });
    expect(link).toHaveAttribute('href', '/capture-scan');
  });

  it('shows "Metadata" and "Browse GraviScans" links, and hides the shared "Browse Scans" link, in graviscan mode — while "Experiments" remains visible', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    expect(screen.getByRole('link', { name: /metadata/i })).toHaveAttribute(
      'href',
      '/metadata'
    );
    expect(
      screen.getByRole('link', { name: /browse graviscans/i })
    ).toHaveAttribute('href', '/browse-graviscans');
    expect(
      screen.queryByRole('link', { name: /^browse scans$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /^experiments$/i })
    ).toBeInTheDocument();
  });

  it('shows the shared "Browse Scans" link and no GraviScan-specific links in cylinderscan mode', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    expect(
      screen.getByRole('link', { name: /^browse scans$/i })
    ).toHaveAttribute('href', '/browse-scans');
    expect(
      screen.queryByRole('link', { name: /metadata/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /browse graviscans/i })
    ).not.toBeInTheDocument();
  });

  it('orders cylinderscan-mode links Daily-Workflow-first: Home, Camera Settings, Capture Scan, Browse Scans, Export Scans, then Setup: Scientists, Phenotypers, Accessions, Experiments', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/',
      '/camera-settings',
      '/capture-scan',
      '/browse-scans',
      '/export',
      '/scientists',
      '/phenotypers',
      '/accessions',
      '/experiments',
    ]);
  });

  it('orders graviscan-mode links Daily-Workflow-first: Home, Configure Scanner, Capture Scan, Browse GraviScans, then Setup: Scientists, Phenotypers, Metadata, Experiments', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/',
      '/configure-scanner',
      '/capture-scan',
      '/browse-graviscans',
      '/scientists',
      '/phenotypers',
      '/metadata',
      '/experiments',
    ]);
  });

  it('leaves the default/no-mode link order unchanged: Home, Scientists, Phenotypers, Experiments, Browse Scans, Export Scans', async () => {
    renderLayout(null);
    await waitFor(() => screen.getByText(/scanner:/i));

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/',
      '/scientists',
      '/phenotypers',
      '/experiments',
      '/browse-scans',
      '/export',
    ]);
  });
});

describe('Layout shell and nav-link colors', () => {
  it('uses bg-stone-100 for the shell background, not bg-gray-50, in cylinderscan mode', async () => {
    const { container } = renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const shell = container.querySelector('.flex.h-screen');
    expect(shell?.className).toContain('bg-stone-100');
    expect(shell?.className).not.toContain('bg-gray-50');
  });

  it('uses bg-stone-100 for the shell background, not bg-gray-50, in graviscan mode', async () => {
    const { container } = renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const shell = container.querySelector('.flex.h-screen');
    expect(shell?.className).toContain('bg-stone-100');
    expect(shell?.className).not.toContain('bg-gray-50');
  });

  it('the active Home link uses the lime/stone active treatment, not blue', async () => {
    renderLayout('cylinderscan', '/');
    await waitFor(() => screen.getByText(/scanner:/i));

    const homeLink = screen.getByRole('link', { name: /^home$/i });
    expect(homeLink.className).toContain('bg-stone-200');
    expect(homeLink.className).toContain('text-lime-800');
    expect(homeLink.className).toContain('border-r-4');
    expect(homeLink.className).toContain('border-lime-800');
  });

  it('non-active links carry the lime/stone hover treatment, not blue', async () => {
    renderLayout('cylinderscan', '/');
    await waitFor(() => screen.getByText(/scanner:/i));

    const scientistsLink = screen.getByRole('link', { name: /^scientists$/i });
    expect(scientistsLink.className).toContain('hover:bg-stone-100');
    expect(scientistsLink.className).toContain('hover:text-lime-800');
  });

  it('no nav link, in either mode, has any blue-* class', async () => {
    renderLayout('cylinderscan', '/');
    await waitFor(() => screen.getByText(/scanner:/i));
    screen.getAllByRole('link').forEach((link) => {
      expect(link.className).not.toMatch(/blue-/);
    });

    renderLayout('graviscan', '/');
    await waitFor(() => screen.getAllByText(/scanner:/i));
    screen.getAllByRole('link').forEach((link) => {
      expect(link.className).not.toMatch(/blue-/);
    });
  });
});

describe('Layout wedge banner wiring', () => {
  it('mounts the wedge banner (subscribes to onWedgeDetected) in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.electron.gravi as any).onWedgeDetected).toHaveBeenCalled();
  });

  it('does not mount the wedge banner (no onWedgeDetected subscription) in cylinderscan mode', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gravi = window.electron.gravi as any;
    expect(gravi.onWedgeDetected).not.toHaveBeenCalled();
  });

  it('renders the wedge banner app-wide — alongside whatever child route is active, not scoped to one screen', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));
    expect(screen.getByText('Home content')).toBeInTheDocument();

    act(() => {
      wedgeListeners.forEach((cb) =>
        cb({
          scanner_id: 'sc-1',
          signature: 'sane_start_invalid',
          session_id: 'sess-1',
          cycle_number: 1,
          timestamp: '2026-08-03T00:00:00.000Z',
          error_message: 'epkowa: sane_start: Invalid argument',
        })
      );
    });

    // The banner and the (unrelated) index route content are both visible
    // at the same time — proves the banner isn't scoped to a dedicated
    // scan screen (design.md Decision 4).
    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });
});

describe('Layout upload-status indicator', () => {
  it('renders nothing when there is no in-flight/recent upload', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    expect(
      screen.queryByTestId('upload-status-indicator')
    ).not.toBeInTheDocument();
  });

  it('renders progress while in flight', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    fireUploadProgress({
      completedImages: 2,
      totalImages: 5,
      failedImages: 0,
      currentExperiment: 'Exp',
    });

    expect(screen.getByTestId('upload-status-indicator')).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('has a dismiss control that hides it until the next event, and does not auto-dismiss on a timer', async () => {
    vi.useFakeTimers();
    try {
      renderLayout('graviscan');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      fireUploadProgress({
        completedImages: 2,
        totalImages: 5,
        failedImages: 0,
        currentExperiment: 'Exp',
      });

      const dismissButton = screen.getByRole('button', { name: /dismiss/i });
      act(() => {
        dismissButton.click();
      });
      expect(
        screen.queryByTestId('upload-status-indicator')
      ).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });
      // Still hidden after a long wait — no auto-dismiss timer to undo the
      // manual dismiss, and no new event fired either.
      expect(
        screen.queryByTestId('upload-status-indicator')
      ).not.toBeInTheDocument();

      fireUploadProgress({
        completedImages: 4,
        totalImages: 5,
        failedImages: 0,
        currentExperiment: 'Exp',
      });
      expect(screen.getByTestId('upload-status-indicator')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays dismissed when a duplicate/stale event with identical content re-fires', async () => {
    // Each IPC delivery is a fresh object (structured clone), so comparing
    // the dismissed value by reference — rather than by field value — means
    // a harmless duplicate/retry event with the exact same content would
    // silently undo the user's dismiss action.
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));
    const progress = {
      completedImages: 2,
      totalImages: 5,
      failedImages: 0,
      currentExperiment: 'Exp',
    };
    fireUploadProgress(progress);

    act(() => {
      screen.getByRole('button', { name: /dismiss/i }).click();
    });
    expect(
      screen.queryByTestId('upload-status-indicator')
    ).not.toBeInTheDocument();

    // A new object, but field-for-field identical to what was dismissed.
    fireUploadProgress({ ...progress });
    expect(
      screen.queryByTestId('upload-status-indicator')
    ).not.toBeInTheDocument();
  });

  it('persists across a route change (stays visible on Configure Scanner, not just Home)', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));
    fireUploadProgress({
      completedImages: 1,
      totalImages: 5,
      failedImages: 0,
      currentExperiment: 'Exp',
    });
    expect(screen.getByTestId('upload-status-indicator')).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /configure scanner/i });
    act(() => {
      link.click();
    });

    await waitFor(() => {
      expect(screen.getByText('Configure Scanner content')).toBeInTheDocument();
    });
    expect(screen.getByTestId('upload-status-indicator')).toBeInTheDocument();
  });
});

describe('Layout unsaved-changes nav guard', () => {
  it('confirms before navigating away from a page with unsaved changes, and stays put if declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    act(() => {
      screen.getByRole('link', { name: /^metadata$/i }).click();
    });
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      screen.getByRole('link', { name: /^home$/i }).click();
    });

    expect(confirmSpy).toHaveBeenCalled();
    // Declined — navigation must not have happened.
    expect(screen.getByText('Metadata content')).toBeInTheDocument();
  });

  it('navigates away when the confirmation is accepted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    act(() => {
      screen.getByRole('link', { name: /^metadata$/i }).click();
    });
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      screen.getByRole('link', { name: /^home$/i }).click();
    });

    await waitFor(() => {
      expect(screen.getByText('Home content')).toBeInTheDocument();
    });
  });

  it('does not prompt when navigating away from a page with no unsaved changes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    act(() => {
      screen.getByRole('link', { name: /^configure scanner$/i }).click();
    });
    await waitFor(() => screen.getByText('Configure Scanner content'));

    act(() => {
      screen.getByRole('link', { name: /^home$/i }).click();
    });

    await waitFor(() => {
      expect(screen.getByText('Home content')).toBeInTheDocument();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('hard-blocks navigation (alert, not a dismissable confirm) while an import is actually in flight', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLayout('graviscan', '/metadata-importing');
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      screen.getByRole('link', { name: /^home$/i }).click();
    });

    expect(alertSpy).toHaveBeenCalled();
    // A dismissable confirm (which the user could accept) must never even
    // be offered while a write is actually in flight — the whole point is
    // that "leave anyway" isn't a safe option here.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Metadata content')).toBeInTheDocument();
  });

  it('does not prompt for a NavLink click that targets the current route', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLayout('graviscan', '/metadata');
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      screen.getByRole('link', { name: /^metadata$/i }).click();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Metadata content')).toBeInTheDocument();
  });

  it('the machine-config keyboard shortcut respects the same guard', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderLayout('graviscan', '/metadata');
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          ctrlKey: true,
          shiftKey: true,
          code: 'Comma',
        })
      );
    });

    // Declined — navigation must not have happened.
    expect(screen.getByText('Metadata content')).toBeInTheDocument();
  });

  it('the machine-config keyboard shortcut hard-blocks (not a dismissable confirm) while an import is actually in flight', async () => {
    // Round 2's fix commit specifically claimed this exact scenario — the
    // keyboard shortcut reaching the same hard block as a NavLink click —
    // but no test exercised the keyboard path against blockNavigation
    // (only against hasUnsavedChanges); this closes that gap.
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderLayout('graviscan', '/metadata-importing');
    await waitFor(() => screen.getByText('Metadata content'));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          ctrlKey: true,
          shiftKey: true,
          code: 'Comma',
        })
      );
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Metadata content')).toBeInTheDocument();
  });
});
