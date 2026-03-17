/**
 * Database Operations Tests
 *
 * Tests for Prisma database operations to ensure schema integrity
 * and CRUD operations work correctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Use dev database for testing
// Tests will clean up after themselves
const prisma = new PrismaClient();

/**
 * Clean database in correct FK order
 * Runs before each test to ensure isolation
 */
async function cleanDatabase() {
  // Delete in correct order (deepest children first)
  await prisma.image.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.plantAccessionMappings.deleteMany();
  await prisma.experiment.deleteMany();
  await prisma.accessions.deleteMany();
  await prisma.phenotyper.deleteMany();
  await prisma.scientist.deleteMany();
}

beforeAll(async () => {
  // Ensure database is connected
  await prisma.$connect();
});

afterAll(async () => {
  // Clean up and disconnect
  await cleanDatabase();
  await prisma.$disconnect();
});

// Clean database before each test for perfect isolation
beforeEach(async () => {
  await cleanDatabase();
});

describe('Database Schema', () => {
  describe('Scientist Model', () => {
    it('should create a scientist', async () => {
      const scientist = await prisma.scientist.create({
        data: {
          name: 'Dr. Test Scientist',
          email: 'test.scientist@salk.edu',
        },
      });

      expect(scientist).toBeDefined();
      expect(scientist.id).toBeTruthy();
      expect(scientist.name).toBe('Dr. Test Scientist');
      expect(scientist.email).toBe('test.scientist@salk.edu');
    });

    it('should enforce unique email constraint', async () => {
      await prisma.scientist.create({
        data: {
          name: 'Dr. First',
          email: 'duplicate@salk.edu',
        },
      });

      await expect(
        prisma.scientist.create({
          data: {
            name: 'Dr. Second',
            email: 'duplicate@salk.edu',
          },
        })
      ).rejects.toThrow();
    });

    it('should list all scientists', async () => {
      await prisma.scientist.createMany({
        data: [
          { name: 'Dr. Alice', email: 'alice@salk.edu' },
          { name: 'Dr. Bob', email: 'bob@salk.edu' },
        ],
      });

      const scientists = await prisma.scientist.findMany();
      expect(scientists).toHaveLength(2);
    });
  });

  describe('Phenotyper Model', () => {
    it('should create a phenotyper', async () => {
      const phenotyper = await prisma.phenotyper.create({
        data: {
          name: 'John Doe',
          email: 'john.doe@salk.edu',
        },
      });

      expect(phenotyper).toBeDefined();
      expect(phenotyper.id).toBeTruthy();
      expect(phenotyper.name).toBe('John Doe');
    });

    it('should enforce unique email constraint', async () => {
      await prisma.phenotyper.create({
        data: {
          name: 'First User',
          email: 'same@salk.edu',
        },
      });

      await expect(
        prisma.phenotyper.create({
          data: {
            name: 'Second User',
            email: 'same@salk.edu',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Accessions Model', () => {
    it('should create an accession', async () => {
      const accession = await prisma.accessions.create({
        data: {
          name: 'ACC-TEST-001',
        },
      });

      expect(accession).toBeDefined();
      expect(accession.id).toBeTruthy();
      expect(accession.name).toBe('ACC-TEST-001');
      expect(accession.createdAt).toBeInstanceOf(Date);
    });

    it('should allow multiple accessions with same name', async () => {
      await prisma.accessions.createMany({
        data: [
          { name: 'ACC-001' },
          { name: 'ACC-001' }, // Duplicates allowed
        ],
      });

      const accessions = await prisma.accessions.findMany({
        where: { name: 'ACC-001' },
      });
      expect(accessions).toHaveLength(2);
    });
  });

  describe('Experiment Model', () => {
    let scientist: { id: string; name: string; email: string };

    beforeEach(async () => {
      // Delete in correct order: scans -> experiments -> scientists/accessions
      await prisma.image.deleteMany();
      await prisma.scan.deleteMany();
      await prisma.experiment.deleteMany();
      await prisma.scientist.deleteMany();
      await prisma.accessions.deleteMany();

      scientist = await prisma.scientist.create({
        data: {
          name: 'Dr. Test',
          email: 'test@salk.edu',
        },
      });
    });

    it('should create an experiment', async () => {
      const experiment = await prisma.experiment.create({
        data: {
          name: 'test-experiment',
          species: 'Amaranthus',
          scientist_id: scientist.id,
        },
      });

      expect(experiment).toBeDefined();
      expect(experiment.id).toBeTruthy();
      expect(experiment.name).toBe('test-experiment');
      expect(experiment.species).toBe('Amaranthus');
      expect(experiment.scientist_id).toBe(scientist.id);
    });

    it('should create experiment without scientist', async () => {
      const experiment = await prisma.experiment.create({
        data: {
          name: 'independent-experiment',
          species: 'Amaranthus',
        },
      });

      expect(experiment.scientist_id).toBeNull();
    });

    it('should include scientist in query', async () => {
      await prisma.experiment.create({
        data: {
          name: 'test-experiment',
          species: 'Amaranthus',
          scientist_id: scientist.id,
        },
      });

      const experiment = await prisma.experiment.findFirst({
        include: { scientist: true },
      });

      expect(experiment?.scientist).toBeDefined();
      expect(experiment?.scientist?.name).toBe('Dr. Test');
    });
  });

  describe('Scan Model', () => {
    let experiment: { id: string; name: string; species: string };
    let phenotyper: { id: string; name: string; email: string };
    let accession: { id: string; name: string };

    beforeEach(async () => {
      await prisma.image.deleteMany();
      await prisma.scan.deleteMany();
      await prisma.experiment.deleteMany();
      await prisma.phenotyper.deleteMany();
      await prisma.scientist.deleteMany();
      await prisma.accessions.deleteMany();

      const scientist = await prisma.scientist.create({
        data: {
          name: 'Dr. Test',
          email: 'test@salk.edu',
        },
      });

      phenotyper = await prisma.phenotyper.create({
        data: {
          name: 'Test Phenotyper',
          email: 'phenotyper@salk.edu',
        },
      });

      accession = await prisma.accessions.create({
        data: {
          name: 'ACC-TEST',
        },
      });

      experiment = await prisma.experiment.create({
        data: {
          name: 'test-experiment',
          species: 'Amaranthus',
          scientist_id: scientist.id,
          accession_id: accession.id,
        },
      });
    });

    it('should create a scan with all required fields', async () => {
      const scan = await prisma.scan.create({
        data: {
          experiment_id: experiment.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Station-A',
          plant_id: 'PLANT-001',
          accession_name: 'Col-0',
          path: './scans/test/PLANT-001',
          capture_date: new Date(),
          num_frames: 72,
          exposure_time: 10000,
          gain: 5.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 36.0,
          wave_number: 1,
          plant_age_days: 14,
        },
      });

      expect(scan).toBeDefined();
      expect(scan.id).toBeTruthy();
      expect(scan.plant_id).toBe('PLANT-001');
      expect(scan.num_frames).toBe(72);
      expect(scan.exposure_time).toBe(10000);
      expect(scan.deleted).toBe(false); // Default value
    });

    it('should include relations in query', async () => {
      await prisma.scan.create({
        data: {
          experiment_id: experiment.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Station-A',
          plant_id: 'PLANT-001',
          path: './scans/test/PLANT-001',
          num_frames: 72,
          exposure_time: 10000,
          gain: 5.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 36.0,
          wave_number: 1,
          plant_age_days: 14,
        },
      });

      const scan = await prisma.scan.findFirst({
        include: {
          experiment: true,
          phenotyper: true,
          images: true,
        },
      });

      expect(scan?.experiment).toBeDefined();
      expect(scan?.phenotyper).toBeDefined();
      expect(scan?.experiment.name).toBe('test-experiment');
      expect(scan?.phenotyper.name).toBe('Test Phenotyper');
    });

    it('should filter scans by experiment', async () => {
      await prisma.scan.create({
        data: {
          experiment_id: experiment.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Station-A',
          plant_id: 'PLANT-001',
          path: './scans/test/PLANT-001',
          num_frames: 72,
          exposure_time: 10000,
          gain: 5.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 36.0,
          wave_number: 1,
          plant_age_days: 14,
        },
      });

      const scans = await prisma.scan.findMany({
        where: { experiment_id: experiment.id },
      });

      expect(scans).toHaveLength(1);
      expect(scans[0].plant_id).toBe('PLANT-001');
    });

    it('should filter scans by plant_id', async () => {
      await prisma.scan.createMany({
        data: [
          {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-001',
            path: './scans/test/PLANT-001',
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
          {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-002',
            path: './scans/test/PLANT-002',
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        ],
      });

      const scans = await prisma.scan.findMany({
        where: { plant_id: 'PLANT-001' },
      });

      expect(scans).toHaveLength(1);
      expect(scans[0].plant_id).toBe('PLANT-001');
    });

    describe('getRecent scans query', () => {
      it('should return today scans sorted by capture_date desc', async () => {
        const now = new Date();
        const earlier = new Date(now.getTime() - 60000); // 1 minute earlier

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-EARLIER',
            path: './scans/test/PLANT-EARLIER',
            capture_date: earlier,
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-LATER',
            path: './scans/test/PLANT-LATER',
            capture_date: now,
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        // Query for today's scans, sorted by capture_date desc
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const scans = await prisma.scan.findMany({
          where: {
            capture_date: {
              gte: today,
              lt: tomorrow,
            },
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        expect(scans).toHaveLength(2);
        expect(scans[0].plant_id).toBe('PLANT-LATER'); // Most recent first
        expect(scans[1].plant_id).toBe('PLANT-EARLIER');
      });

      it('should limit results to specified count', async () => {
        // Create 15 scans
        for (let i = 0; i < 15; i++) {
          await prisma.scan.create({
            data: {
              experiment_id: experiment.id,
              phenotyper_id: phenotyper.id,
              scanner_name: 'Station-A',
              plant_id: `PLANT-${i.toString().padStart(3, '0')}`,
              path: `./scans/test/PLANT-${i}`,
              capture_date: new Date(),
              num_frames: 72,
              exposure_time: 10000,
              gain: 5.0,
              brightness: 0.5,
              contrast: 1.0,
              gamma: 1.0,
              seconds_per_rot: 36.0,
              wave_number: 1,
              plant_age_days: 14,
            },
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const scans = await prisma.scan.findMany({
          where: {
            capture_date: {
              gte: today,
              lt: tomorrow,
            },
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
          take: 10, // Limit to 10
        });

        expect(scans).toHaveLength(10);
      });

      it('should exclude deleted scans', async () => {
        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-ACTIVE',
            path: './scans/test/PLANT-ACTIVE',
            capture_date: new Date(),
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
            deleted: false,
          },
        });

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-DELETED',
            path: './scans/test/PLANT-DELETED',
            capture_date: new Date(),
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
            deleted: true,
          },
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const scans = await prisma.scan.findMany({
          where: {
            capture_date: {
              gte: today,
              lt: tomorrow,
            },
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        expect(scans).toHaveLength(1);
        expect(scans[0].plant_id).toBe('PLANT-ACTIVE');
      });

      it('should filter by experiment_id when provided', async () => {
        // Create a second experiment
        const scientist2 = await prisma.scientist.create({
          data: {
            name: 'Dr. Other',
            email: 'other@salk.edu',
          },
        });
        const experiment2 = await prisma.experiment.create({
          data: {
            name: 'other-experiment',
            species: 'Amaranthus',
            scientist_id: scientist2.id,
          },
        });

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-EXP1',
            path: './scans/test/PLANT-EXP1',
            capture_date: new Date(),
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        await prisma.scan.create({
          data: {
            experiment_id: experiment2.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-EXP2',
            path: './scans/test/PLANT-EXP2',
            capture_date: new Date(),
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const scans = await prisma.scan.findMany({
          where: {
            experiment_id: experiment.id,
            capture_date: {
              gte: today,
              lt: tomorrow,
            },
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        expect(scans).toHaveLength(1);
        expect(scans[0].plant_id).toBe('PLANT-EXP1');
      });

      it('should exclude scans from previous days', async () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-TODAY',
            path: './scans/test/PLANT-TODAY',
            capture_date: new Date(),
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        await prisma.scan.create({
          data: {
            experiment_id: experiment.id,
            phenotyper_id: phenotyper.id,
            scanner_name: 'Station-A',
            plant_id: 'PLANT-YESTERDAY',
            path: './scans/test/PLANT-YESTERDAY',
            capture_date: yesterday,
            num_frames: 72,
            exposure_time: 10000,
            gain: 5.0,
            brightness: 0.5,
            contrast: 1.0,
            gamma: 1.0,
            seconds_per_rot: 36.0,
            wave_number: 1,
            plant_age_days: 14,
          },
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const scans = await prisma.scan.findMany({
          where: {
            capture_date: {
              gte: today,
              lt: tomorrow,
            },
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
        });

        expect(scans).toHaveLength(1);
        expect(scans[0].plant_id).toBe('PLANT-TODAY');
      });
    });
  });

  describe('Image Model', () => {
    let scan: { id: string; experiment_id: string; phenotyper_id: string };

    beforeEach(async () => {
      await prisma.image.deleteMany();
      await prisma.scan.deleteMany();
      await prisma.experiment.deleteMany();
      await prisma.phenotyper.deleteMany();
      await prisma.scientist.deleteMany();
      await prisma.accessions.deleteMany();

      const scientist = await prisma.scientist.create({
        data: {
          name: 'Dr. Test',
          email: 'test@salk.edu',
        },
      });

      const phenotyper = await prisma.phenotyper.create({
        data: {
          name: 'Test Phenotyper',
          email: 'phenotyper@salk.edu',
        },
      });

      const experiment = await prisma.experiment.create({
        data: {
          name: 'test-experiment',
          species: 'Amaranthus',
          scientist_id: scientist.id,
        },
      });

      scan = await prisma.scan.create({
        data: {
          experiment_id: experiment.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Station-A',
          plant_id: 'PLANT-001',
          path: './scans/test/PLANT-001',
          num_frames: 72,
          exposure_time: 10000,
          gain: 5.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 36.0,
          wave_number: 1,
          plant_age_days: 14,
        },
      });
    });

    it('should create an image', async () => {
      const image = await prisma.image.create({
        data: {
          scan_id: scan.id,
          frame_number: 0,
          path: './scans/test/PLANT-001/frame_0000.png',
          status: 'completed',
        },
      });

      expect(image).toBeDefined();
      expect(image.id).toBeTruthy();
      expect(image.frame_number).toBe(0);
      expect(image.status).toBe('completed');
    });

    it('should use default status "pending"', async () => {
      const image = await prisma.image.create({
        data: {
          scan_id: scan.id,
          frame_number: 0,
          path: './scans/test/PLANT-001/frame_0000.png',
        },
      });

      expect(image.status).toBe('pending');
    });

    it('should create multiple images for a scan', async () => {
      const images = [];
      for (let i = 0; i < 72; i++) {
        images.push({
          scan_id: scan.id,
          frame_number: i,
          path: `./scans/test/PLANT-001/frame_${i.toString().padStart(4, '0')}.png`,
          status: 'completed',
        });
      }

      await prisma.image.createMany({ data: images });

      const count = await prisma.image.count({
        where: { scan_id: scan.id },
      });

      expect(count).toBe(72);
    });

    it('should include scan in query', async () => {
      await prisma.image.create({
        data: {
          scan_id: scan.id,
          frame_number: 0,
          path: './scans/test/PLANT-001/frame_0000.png',
        },
      });

      const image = await prisma.image.findFirst({
        include: { scan: true },
      });

      expect(image?.scan).toBeDefined();
      expect(image?.scan.plant_id).toBe('PLANT-001');
    });
  });

  describe('PlantAccessionMappings Model', () => {
    let accession: { id: string; name: string };

    beforeEach(async () => {
      await prisma.plantAccessionMappings.deleteMany();
      await prisma.accessions.deleteMany();

      accession = await prisma.accessions.create({
        data: {
          name: 'ACC-TEST',
        },
      });
    });

    it('should create a plant-accession mapping', async () => {
      const mapping = await prisma.plantAccessionMappings.create({
        data: {
          plant_barcode: 'PLANT-001',
          accession_name: 'Col-0',
          accession_file_id: accession.id,
        },
      });

      expect(mapping).toBeDefined();
      expect(mapping.id).toBeTruthy();
      expect(mapping.plant_barcode).toBe('PLANT-001');
      expect(mapping.accession_name).toBe('Col-0');
    });

    it('should include accession in query', async () => {
      await prisma.plantAccessionMappings.create({
        data: {
          plant_barcode: 'PLANT-001',
          accession_name: 'Col-0',
          accession_file_id: accession.id,
        },
      });

      const mapping = await prisma.plantAccessionMappings.findFirst({
        include: { accession: true },
      });

      expect(mapping?.accession).toBeDefined();
      expect(mapping?.accession.name).toBe('ACC-TEST');
    });
  });
});
