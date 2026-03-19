const { PrismaClient } = require('@prisma/client');
const path = require('path');
const dbPath = path.resolve(__dirname, 'prisma/dev.db');
const db = new PrismaClient({ datasources: { db: { url: 'file:' + dbPath } } });

(async () => {
  const sessions = await db.graviScanSession.findMany({
    orderBy: { started_at: 'desc' },
    take: 2,
  });
  console.log('=== Sessions ===');
  for (const s of sessions) {
    console.log(
      JSON.stringify({
        id: s.id.slice(0, 8),
        mode: s.mode,
        status: s.status,
        started: s.started_at,
        cycles: s.total_cycles,
      })
    );
  }

  const latestSession = sessions[0];
  if (!latestSession) {
    console.log('No sessions found');
    return;
  }

  const scans = await db.graviScan.findMany({
    where: { session_id: latestSession.id },
    include: {
      images: true,
      scanner: { select: { id: true, usb_device: true } },
    },
    orderBy: [
      { cycle_number: 'asc' },
      { scanner_id: 'asc' },
      { plate_index: 'asc' },
    ],
  });

  console.log(
    '\n=== Scans for session ' +
      latestSession.id.slice(0, 8) +
      ' (' +
      scans.length +
      ' records) ==='
  );
  let prevCycle = null;
  for (const s of scans) {
    if (s.cycle_number !== prevCycle) {
      console.log('\n--- Wave ' + s.cycle_number + ' ---');
      prevCycle = s.cycle_number;
    }
    const img = s.images[0];
    const filename = img ? img.path.split('/').pop() : 'NO IMAGE';
    console.log(
      '  scanner:dev' +
        s.scanner.usb_device +
        ' plate:' +
        s.plate_index +
        ' res:' +
        s.resolution +
        ' grid:' +
        s.grid_mode +
        ' | ' +
        filename +
        ' | status:' +
        (img ? img.status : 'N/A')
    );
  }

  // Check for issues
  const waveGroups = {};
  for (const s of scans) {
    const key = 'wave_' + s.cycle_number;
    if (!waveGroups[key]) waveGroups[key] = [];
    waveGroups[key].push(s);
  }

  console.log('\n=== Summary ===');
  const scannerIds = [...new Set(scans.map((s) => s.scanner_id))];
  console.log('Scanners: ' + scannerIds.length);
  console.log('Total waves: ' + Object.keys(waveGroups).length);
  for (const [wave, records] of Object.entries(waveGroups)) {
    const plates = records.map(
      (r) => 'dev' + r.scanner.usb_device + ':' + r.plate_index
    );
    const hasAllImages = records.every((r) => r.images.length > 0);
    console.log(
      '  ' +
        wave +
        ': ' +
        records.length +
        ' scans [' +
        plates.join(', ') +
        '] images:' +
        (hasAllImages ? 'OK' : 'MISSING')
    );
  }

  // Check timestamps are unique per wave
  console.log('\n=== Timestamp Check ===');
  for (const [wave, records] of Object.entries(waveGroups)) {
    const timestamps = records.map((r) => {
      const img = r.images[0];
      if (!img) return 'N/A';
      const match = img.path.match(/(\d{8}T\d{6})/);
      return match ? match[1] : 'no-ts';
    });
    const uniqueTs = [...new Set(timestamps)];
    console.log(
      '  ' +
        wave +
        ' timestamps: ' +
        uniqueTs.join(', ') +
        (uniqueTs.length === 1 ? ' (consistent)' : ' (MIXED)')
    );
  }

  await db.$disconnect();
})();
