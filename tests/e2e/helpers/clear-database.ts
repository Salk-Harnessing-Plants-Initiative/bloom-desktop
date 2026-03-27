import { PrismaClient } from '@prisma/client';

/**
 * Clear all data from the test database.
 *
 * Deletes rows in dependency order (children before parents) so foreign key
 * constraints are never violated.  Call this in a `test.beforeEach` to give
 * every test a clean slate while keeping the same Electron app + Prisma
 * connection alive (beforeAll/afterAll pattern).
 */
export async function clearDatabase(prisma: PrismaClient): Promise<void> {
  // Delete in reverse-dependency order to avoid FK constraint errors.
  // Leaf tables first, then parents.

  // Images & scans
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();

  // GraviScan chain
  await prisma.graviImage.deleteMany();
  await prisma.graviScan.deleteMany();
  await prisma.graviScanSession.deleteMany();
  await prisma.graviScanPlateAssignment.deleteMany();

  // Plate accession chain
  await prisma.graviPlateSection.deleteMany();
  await prisma.graviPlateAccession.deleteMany();

  // Plant-accession mappings (before accessions)
  await prisma.plantAccessionMappings.deleteMany();

  // Core entities
  await prisma.experiment.deleteMany();
  await prisma.accessions.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
  await prisma.graviScanner.deleteMany();
}
