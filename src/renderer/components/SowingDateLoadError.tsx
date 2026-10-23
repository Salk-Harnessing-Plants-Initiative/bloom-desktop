/**
 * Under the wave number on Capture Scan when the experiment's sowing dates
 * couldn't be read (#407). Usually a briefly locked database: a restart clears
 * it. Scanning waits, so no scan is saved without its sowing date.
 */

export function SowingDateLoadError({ error }: { error: string }) {
  return (
    <div
      className="mt-2 bg-red-50 border-2 border-red-400 rounded-lg p-3 text-sm"
      role="alert"
      data-testid="sowing-date-load-error"
    >
      <p className="font-medium text-red-800">
        Couldn&apos;t load the start dates. Close Bloom Desktop and open it
        again.
      </p>
      <p className="text-red-700">
        If it keeps happening, tell the maintainers.
      </p>
      <p className="mt-1 text-xs text-gray-500">Details: {error}</p>
    </div>
  );
}
