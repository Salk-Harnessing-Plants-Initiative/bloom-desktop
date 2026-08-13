/**
 * Graded-severity QR verification result banner — "GraviScan QR
 * Verification Result Banner" (ui-management-pages/spec.md). Red beats
 * amber beats green; within amber, every applicable cause renders (no
 * undefined single-pick priority), and `incorrect`/`lookup_failed` each
 * get their own distinct title rather than folding into "QR Unreadable".
 */
import type {
  QRVerifyPlateResult,
  VerificationStatus,
} from '../../../types/graviscan';

export interface QRVerificationBannerProps {
  results: QRVerifyPlateResult[];
}

const AMBER_CAUSES: Array<{
  status: VerificationStatus;
  title: string;
  detail: string;
}> = [
  {
    status: 'unreadable',
    title: 'Some Plates Unreadable',
    detail:
      'One or more plate QR codes could not be read from the captured image.',
  },
  {
    status: 'needs_review',
    title: 'Manual Review Needed',
    detail: 'One or more plates need manual review of the detected result.',
  },
  {
    status: 'incorrect',
    title: 'Plate Mismatch Detected',
    detail:
      'One or more plates show a barcode that does not match the assigned plant.',
  },
  {
    status: 'lookup_failed',
    title: 'Verification Lookup Failed',
    detail:
      'One or more plates could not be checked at all — no linked wave metadata was found. Retry the run once metadata is linked, rather than reviewing this result.',
  },
];

export function QRVerificationBanner({ results }: QRVerificationBannerProps) {
  if (results.length === 0) return null;

  const statuses = new Set(results.map((r) => r.status));

  if (statuses.has('duplicate_qr')) {
    return (
      <div
        data-testid="qr-verification-banner"
        className="bg-red-50 border border-red-500 text-red-800 rounded p-3 text-sm"
      >
        <div className="font-semibold">Duplicate QR Codes Detected</div>
        <div>
          The same QR code was detected on more than one plate — check for a
          physical duplicate or misprint.
        </div>
      </div>
    );
  }

  const activeCauses = AMBER_CAUSES.filter((cause) =>
    statuses.has(cause.status)
  );
  if (activeCauses.length > 0) {
    return (
      <div
        data-testid="qr-verification-banner"
        className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-3 text-sm space-y-2"
      >
        {activeCauses.map((cause) => (
          <div key={cause.status}>
            <div className="font-semibold">{cause.title}</div>
            <div>{cause.detail}</div>
          </div>
        ))}
      </div>
    );
  }

  // A swap is still a green (non-blocking) result — it was already
  // successfully auto-corrected (design.md Decision 2, point 5) — but the
  // detail text distinguishes it from a genuinely zero-incident run, since
  // it's an audit-relevant event the operator should be able to see
  // (design.md Decision 18).
  const swappedCount = results.filter((r) => r.status === 'swapped').length;

  return (
    <div
      data-testid="qr-verification-banner"
      className="bg-green-50 border border-green-500 text-green-800 rounded p-3 text-sm"
    >
      <div className="font-semibold">QR Verification Complete</div>
      <div>
        {swappedCount > 0
          ? `${swappedCount} plate position${swappedCount === 1 ? '' : 's'} ${swappedCount === 1 ? 'was' : 'were'} auto-corrected after a detected swap — no action needed.`
          : 'Every plate verified correctly.'}
      </div>
    </div>
  );
}
