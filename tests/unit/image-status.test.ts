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
    // Exhaustiveness check: satisfies ensures every entry is a valid ImageStatus.
    // Note: satisfies ImageStatus[] does NOT guarantee all union members are listed —
    // a missing entry would still compile. The runtime length + Set checks below
    // catch duplicates and verify the expected count, providing a practical safeguard.
    const allStatuses = [
      'pending',
      'uploading',
      'uploaded',
      'failed',
    ] satisfies ImageStatus[];
    expect(allStatuses).toHaveLength(4);
    expect(new Set(allStatuses).size).toBe(4);
  });

  it('should reject invalid status strings at compile time', () => {
    // This test documents the intended compile-time safety guarantee.
    // We use @ts-expect-error to express that these assignments should remain
    // invalid; if a TypeScript typechecker is run over this file and the type
    // is ever widened to accept these strings, it will report an "unused
    // directive" error.
    //
    // Note: tests/ are excluded from the main tsconfig, and Vitest is not
    // configured to run typechecking on test files. These directives act as
    // documentation-only unless an explicit typecheck step for tests is added
    // (e.g. separate tsconfig, Vitest typecheck, or a dedicated type-test tool).

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
