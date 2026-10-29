import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  LazyThumbnail,
  THUMBNAIL_PRELOAD_MARGIN_PX,
} from '../../../src/renderer/components/LazyThumbnail';

/** An IntersectionObserver the test drives by hand. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  show(isIntersecting: boolean) {
    act(() => {
      this.callback(
        this.observed.map(
          (target) => ({ isIntersecting, target }) as IntersectionObserverEntry
        ),
        this as unknown as IntersectionObserver
      );
    });
  }
}

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

function renderThumbnail(onError = vi.fn()) {
  render(
    <LazyThumbnail
      src="bloom-scan://scan/frame_001.png"
      alt="P1 thumbnail"
      onError={onError}
    />
  );
  return onError;
}

describe('LazyThumbnail', () => {
  it('requests no image while its row is off screen', () => {
    renderThumbnail();

    expect(screen.getByTestId('thumbnail-loading')).toBeInTheDocument();
    expect(screen.queryByAltText('P1 thumbnail')).not.toBeInTheDocument();
    expect(FakeObserver.instances[0].options?.rootMargin).toBe(
      `${THUMBNAIL_PRELOAD_MARGIN_PX}px`
    );
  });

  it('stays a placeholder when the observer reports it still off screen', () => {
    renderThumbnail();
    FakeObserver.instances[0].show(false);

    expect(screen.queryByAltText('P1 thumbnail')).not.toBeInTheDocument();
  });

  it('loads the image once its row comes near the screen, and stops watching', () => {
    renderThumbnail();
    const observer = FakeObserver.instances[0];
    observer.show(true);

    const img = screen.getByAltText('P1 thumbnail');
    expect(img).toHaveAttribute('src', 'bloom-scan://scan/frame_001.png');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(observer.disconnected).toBe(true);
  });

  it('passes on an image error', () => {
    const onError = renderThumbnail();
    FakeObserver.instances[0].show(true);

    screen.getByAltText('P1 thumbnail').dispatchEvent(new Event('error'));
    expect(onError).toHaveBeenCalled();
  });

  it('stops watching when the row goes away', () => {
    const { unmount } = render(
      <LazyThumbnail src="x.png" alt="P1 thumbnail" onError={vi.fn()} />
    );
    unmount();
    expect(FakeObserver.instances[0].disconnected).toBe(true);
  });

  it('shows the image straight away where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderThumbnail();

    expect(screen.getByAltText('P1 thumbnail')).toBeInTheDocument();
  });
});
