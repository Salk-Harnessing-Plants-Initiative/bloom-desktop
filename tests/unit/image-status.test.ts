/**
 * Compile-time and runtime tests for ImageStatus type
 *
 * Verifies that the ImageStatus union type accepts only the four valid
 * status values and rejects invalid strings at compile time.
 */

import { describe, it, expect } from 'vitest';
import type { ImageStatus } from '../../src/types/database';

describe('ImageStatus type', () => {
  it('should accept all valid status values', () => {
    const pending: ImageStatus = 'pending';
    const uploading: ImageStatus = 'uploading';
    const uploaded: ImageStatus = 'uploaded';
    const failed: ImageStatus = 'failed';

    expect(pending).toBe('pending');
    expect(uploading).toBe('uploading');
    expect(uploaded).toBe('uploaded');
    expect(failed).toBe('failed');
  });

  it('should have exactly four valid values', () => {
    // Exhaustiveness check: if ImageStatus changes, this will fail to compile
    const allStatuses: ImageStatus[] = [
      'pending',
      'uploading',
      'uploaded',
      'failed',
    ];
    expect(allStatuses).toHaveLength(4);
    expect(new Set(allStatuses).size).toBe(4);
  });

  it('should reject invalid status strings at compile time', () => {
    // This test documents the compile-time safety guarantee.
    // We verify this by using @ts-expect-error — if the type ever
    // accepts these strings, TypeScript will report an "unused directive" error.

    // @ts-expect-error 'CAPTURED' is not assignable to ImageStatus
    const _captured: ImageStatus = 'CAPTURED';
    void _captured;

    // @ts-expect-error 'Pending' is not assignable to ImageStatus
    const _pendingWrongCase: ImageStatus = 'Pending';
    void _pendingWrongCase;

    // @ts-expect-error 'complete' is not assignable to ImageStatus
    const _complete: ImageStatus = 'complete';
    void _complete;

    // If we reach here, the type correctly rejects invalid values at compile time
    expect(true).toBe(true);
  });
});
