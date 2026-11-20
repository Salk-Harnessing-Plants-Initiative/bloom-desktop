/**
 * Order of GraviScan scanners everywhere they are listed.
 *
 * Detect (Configure Scanner) labels scanners "Scanner 1", "Scanner 2", …
 * in USB-port order, and the scanner lists (Configure Scanner, Capture
 * Scan) use the same order. A scan file's `Sc{K}` is the scanner's position
 * in that list, so `Sc1` is the scanner labelled "Scanner 1", as on the rig,
 * where `Sc{K}` follows the operator's scanner slots.
 */
export function compareByUsbPort(
  a: { usb_port?: string | null },
  b: { usb_port?: string | null }
): number {
  return (a.usb_port || '').localeCompare(b.usb_port || '');
}
