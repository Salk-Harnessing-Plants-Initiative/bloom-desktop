/**
 * Prisma Database Seed Script
 *
 * Populates the database with test data for development.
 * Run with: npm run prisma:seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create scientists
  const scientist1 = await prisma.scientist.upsert({
    where: { email: 'jane.smith@salk.edu' },
    update: {},
    create: {
      name: 'Dr. Jane Smith',
      email: 'jane.smith@salk.edu',
    },
  });
  console.log('✓ Created scientist:', scientist1.name);

  const scientist2 = await prisma.scientist.upsert({
    where: { email: 'bob.jones@salk.edu' },
    update: {},
    create: {
      name: 'Dr. Bob Jones',
      email: 'bob.jones@salk.edu',
    },
  });
  console.log('✓ Created scientist:', scientist2.name);

  // Create phenotypers
  const phenotyper1 = await prisma.phenotyper.upsert({
    where: { email: 'john.doe@salk.edu' },
    update: {},
    create: {
      name: 'John Doe',
      email: 'john.doe@salk.edu',
    },
  });
  console.log('✓ Created phenotyper:', phenotyper1.name);

  const phenotyper2 = await prisma.phenotyper.upsert({
    where: { email: 'alice.williams@salk.edu' },
    update: {},
    create: {
      name: 'Alice Williams',
      email: 'alice.williams@salk.edu',
    },
  });
  console.log('✓ Created phenotyper:', phenotyper2.name);

  // Create accessions with plant mappings
  const accession1 = await prisma.accessions.create({
    data: {
      name: 'ACC-001-Amaranth-Wild',
      mappings: {
        create: [
          { plant_barcode: 'PLANT-001', accession_name: 'Col-0' },
          { plant_barcode: 'PLANT-003', accession_name: 'Ws-0' },
          { plant_barcode: 'PLANT-005', accession_name: 'Ler-0' },
        ],
      },
    },
  });
  console.log('✓ Created accession:', accession1.name, '(3 plant mappings)');

  const accession2 = await prisma.accessions.create({
    data: {
      name: 'ACC-002-Amaranth-Cultivated',
      mappings: {
        create: [
          { plant_barcode: 'PLANT-002', accession_name: 'GT-ABC123' },
          { plant_barcode: 'PLANT-004', accession_name: 'GT-DEF456' },
          { plant_barcode: 'PLANT-006', accession_name: 'GT-GHI789' },
        ],
      },
    },
  });
  console.log('✓ Created accession:', accession2.name, '(3 plant mappings)');

  // Create experiments
  const experiment1 = await prisma.experiment.create({
    data: {
      name: 'drought-stress-2025',
      species: 'Amaranthus hypochondriacus',
      scientist_id: scientist1.id,
      accession_id: accession1.id,
    },
  });
  console.log(
    '✓ Created experiment:',
    experiment1.name,
    `(ID: ${experiment1.id})`
  );

  const experiment2 = await prisma.experiment.create({
    data: {
      name: 'salinity-tolerance-2025',
      species: 'Amaranthus tricolor',
      scientist_id: scientist2.id,
      accession_id: accession2.id,
    },
  });
  console.log(
    '✓ Created experiment:',
    experiment2.name,
    `(ID: ${experiment2.id})`
  );

  // Create sample scans
  const scan1 = await prisma.scan.create({
    data: {
      experiment_id: experiment1.id,
      phenotyper_id: phenotyper1.id,
      scanner_name: 'Station-A-Lab2',
      plant_id: 'PLANT-001',
      accession_name: 'Col-0',
      path: './scans/drought-stress-2025/PLANT-001_1234567890',
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
  console.log('✓ Created scan for plant:', scan1.plant_id);

  const scan2 = await prisma.scan.create({
    data: {
      experiment_id: experiment2.id,
      phenotyper_id: phenotyper1.id,
      scanner_name: 'Station-A-Lab2',
      plant_id: 'PLANT-002',
      accession_name: 'GT-ABC123',
      path: './scans/salinity-tolerance-2025/PLANT-002_1234567891',
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
  console.log('✓ Created scan for plant:', scan2.plant_id);

  // Create sample images for scan1
  const images = [];
  for (let i = 0; i < 72; i++) {
    images.push({
      scan_id: scan1.id,
      frame_number: i,
      path: `./scans/drought-stress-2025/PLANT-001_1234567890/frame_${i.toString().padStart(4, '0')}.png`,
      status: 'completed',
    });
  }
  await prisma.image.createMany({ data: images });
  console.log(`✓ Created ${images.length} images for scan`);

  console.log('\n✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
