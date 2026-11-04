/** Shown while the app reads this station's settings at start-up (#477). */
export function StartupLoader() {
  return (
    <div
      className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50"
      role="status"
      aria-live="polite"
      data-testid="startup-loader"
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-lime-200 border-t-lime-700"
        aria-hidden="true"
      />
      <p className="text-gray-600">Loading this station&apos;s settings…</p>
    </div>
  );
}
