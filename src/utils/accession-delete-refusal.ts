/**
 * The message given when an accession file can't be deleted because experiments that
 * use it have scans. Built in the main process; the Accessions page recognises it to
 * show it as is, rather than as a generic failure.
 */

const REFUSAL_START = "This accession file can't be deleted";

/** "This accession file can't be deleted: … have scans: A (24 scans), B (1 scan)." */
export function accessionDeleteRefusalMessage(
  experiments: ReadonlyArray<{ name: string; scans: number }>
): string {
  const list = experiments
    .map((e) => `${e.name} (${e.scans === 1 ? '1 scan' : `${e.scans} scans`})`)
    .join(', ');
  return `${REFUSAL_START}: experiments that use it have scans: ${list}.`;
}

export function isAccessionDeleteRefusal(message: string | undefined): boolean {
  return message?.startsWith(REFUSAL_START) ?? false;
}
