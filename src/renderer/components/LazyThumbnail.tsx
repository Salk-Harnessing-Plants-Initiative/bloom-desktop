import { useEffect, useRef, useState } from 'react';

/** How far outside the visible area a row may be when its thumbnail starts loading. */
export const THUMBNAIL_PRELOAD_MARGIN_PX = 200;

interface LazyThumbnailProps {
  src: string;
  alt: string;
  onError: () => void;
}

/**
 * A scan thumbnail that requests its image only once its row is about to be on screen.
 * The browser's own loading="lazy" starts images well over 1,000px ahead, which on a page
 * of rows means every full-size frame at once.
 */
export function LazyThumbnail({ src, alt, onError }: LazyThumbnailProps) {
  const placeholder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const element = placeholder.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // Showing the image re-runs this effect, whose cleanup disconnects.
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: `${THUMBNAIL_PRELOAD_MARGIN_PX}px` }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div
        ref={placeholder}
        data-testid="thumbnail-loading"
        className="w-12 h-16 bg-stone-100 border border-stone-200 rounded"
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="w-12 h-16 object-cover rounded border border-gray-200"
      onError={onError}
    />
  );
}
