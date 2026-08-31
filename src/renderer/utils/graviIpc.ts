/**
 * `register-handlers.ts`'s `wrapHandler()` wraps a handful of GraviScan
 * IPC channels (`start-scan`, `cancel-scan`, `get-scan-status`,
 * `get-output-dir`) in a `{ success: true, data: T }` envelope on their
 * normal path, while some early-reject branches (e.g. `start-scan`'s
 * "already scanning" guard) return their own flat `{ success: false,
 * error }` shape directly, never entering that envelope at all —
 * confirmed via direct inspection of `register-handlers.ts` and
 * `ConfigureScanner.tsx`'s own `result.data?.isActive` usage. Every
 * caller of one of these channels must unwrap through this, or it will
 * read `undefined` for every field on the (far more common) success
 * path.
 */
export function unwrapGraviResult<T>(raw: unknown): T {
  if (
    raw &&
    typeof raw === 'object' &&
    'success' in raw &&
    (raw as { success: unknown }).success === true &&
    'data' in raw
  ) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}
