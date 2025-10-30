/**
 * Seed script for production database (~/.bloom/data/bloom.db)
 *
 * This creates test data for manual testing of the packaged app:
 * - Scientists
 * - Phenotypers
 * - Accessions
 * - Experiments
 *
 * Run with: BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx tsx scripts/seed-production.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding production database...\n');

  // Create scientist
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Elizabeth Berrigan',
      email: 'elizabeth@salk.edu',
    },
  });
  console.log('✅ Created scientist:', scientist.name);

  // Create phenotyper
  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'elizabeth',
      email: 'elizabeth@salk.edu',
    },
  });
  console.log('✅ Created phenotyper:', phenotyper.name);

  // Create accession
  const accession = await prisma.accessions.create({
    data: {
      name: 'Col-0',
      species: 'Arabidopsis thaliana',
    },
  });
  console.log('✅ Created accession:', accession.name);

  // Create experiment
  const experiment = await prisma.experiment.create({
    data: {
      experiment_id: 'TEST-2025-001',
      name: 'Test Experiment - Scanner Database Integration',
      species: 'Arabidopsis thaliana',
      scientist_id: scientist.id,
      accessions: {
        connect: { id: accession.id },
      },
    },
  });
  console.log('✅ Created experiment:', experiment.name);

  console.log('\n✨ Production database seeded successfully!\n');
  console.log('📋 You can now test the packaged app with:');
  console.log('   - Experiment ID: TEST-2025-001');
  console.log('   - Phenotyper: elizabeth');
  console.log('   - Plant ID: any value (e.g., PLANT-001)');
  console.log('   - Accession ID: Col-0 (optional)');
  console.log('   - Scanner: any value (e.g., Scanner-01)\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
