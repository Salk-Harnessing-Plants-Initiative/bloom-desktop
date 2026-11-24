/**
 * An accession file whose experiments have scans can't be deleted: the experiments
 * would lose their file (the link is ON DELETE SET NULL), the plant list behind those
 * scans would be gone, and the next Capture Scan for them would refuse every barcode.
 */

/** The part of the Prisma client used here, so tests can pass a fake. */
export interface AccessionDeleteDbLike {
  experiment: {
    findMany(args: {
      where: { accession_id: string };
      select: {
        name: true;
        _count: {
          select: {
            scans: { where: { deleted: false } };
            graviScans: { where: { deleted: false } };
          };
        };
      };
      orderBy: { name: 'asc' };
    }): Promise<
      Array<{ name: string; _count: { scans: number; graviScans: number } }>
    >;
  };
}

const plural = (n: number) => (n === 1 ? '1 scan' : `${n} scans`);

/**
 * Why the file can't be deleted, naming each experiment with scans; null when it
 * can be (no experiments use it, or none of them has a scan yet).
 */
export async function accessionDeleteRefusal(
  db: AccessionDeleteDbLike,
  accessionId: string
): Promise<string | null> {
  const experiments = await db.experiment.findMany({
    where: { accession_id: accessionId },
    select: {
      name: true,
      _count: {
        select: {
          scans: { where: { deleted: false } },
          graviScans: { where: { deleted: false } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  const scanned = experiments
    .map((e) => ({ name: e.name, scans: e._count.scans + e._count.graviScans }))
    .filter((e) => e.scans > 0);
  if (scanned.length === 0) return null;
  const list = scanned.map((e) => `${e.name} (${plural(e.scans)})`).join(', ');
  return `This accession file can't be deleted: experiments that use it have scans: ${list}.`;
}
