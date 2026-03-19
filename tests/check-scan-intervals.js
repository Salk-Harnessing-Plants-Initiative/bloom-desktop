#!/usr/bin/env node
/**
 * Analyze scan timing intervals for TestScan5 images.
 * Groups images by scanner+plate, orders by cycle, and computes
 * the time interval between consecutive scans of the same plate.
 */

const fs = require('fs');
const path = require('path');

const scanDir = path.join(__dirname, '.graviscan');
const prefix = 'TestScan5';

// Parse filename: TestScan5_st_{ts}_et_{ts}_S{N}_{plate}.jpg
const pattern =
  /^TestScan5_st_(\d{8}T\d{6})_et_(\d{8}T\d{6})_(S\d+)_(\d{2})\.jpg$/;

function parseTimestamp(ts) {
  // 20260224T003007 → 2026-02-24T00:30:07
  const iso = ts.replace(
    /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
    '$1-$2-$3T$4:$5:$6'
  );
  return new Date(iso);
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

// Read and parse all matching files
const files = fs
  .readdirSync(scanDir)
  .filter((f) => f.startsWith(prefix) && f.endsWith('.jpg'))
  .map((f) => {
    const m = f.match(pattern);
    if (!m) return null;
    return {
      filename: f,
      startTime: parseTimestamp(m[1]),
      endTime: parseTimestamp(m[2]),
      scanner: m[3],
      plate: m[4],
      stRaw: m[1],
      etRaw: m[2],
    };
  })
  .filter(Boolean);

// Group by scanner + plate
const groups = {};
for (const f of files) {
  const key = `${f.scanner}_${f.plate}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(f);
}

// Sort each group by start time (cycle order)
for (const key of Object.keys(groups).sort()) {
  groups[key].sort((a, b) => a.startTime - b.startTime);
}

// Print results
console.log('='.repeat(80));
console.log(`TestScan5 Timing Analysis — ${files.length} images found`);
console.log('='.repeat(80));

// First, show grid-level timestamp consistency (same grid across scanners)
console.log(
  '\n--- Grid Timestamp Consistency (same grid = same st/et across scanners) ---\n'
);
const byGrid = {};
for (const f of files) {
  const gridKey = `${f.stRaw}_${f.plate}`;
  if (!byGrid[gridKey]) byGrid[gridKey] = [];
  byGrid[gridKey].push(f);
}
for (const [, group] of Object.entries(byGrid).sort()) {
  if (group.length > 1) {
    const allSameSt = group.every((g) => g.stRaw === group[0].stRaw);
    const allSameEt = group.every((g) => g.etRaw === group[0].etRaw);
    const scanners = group.map((g) => g.scanner).join(', ');
    const status = allSameSt && allSameEt ? 'OK' : 'MISMATCH';
    console.log(
      `  Grid ${group[0].plate} st_${group[0].stRaw}: [${scanners}] → ${status}`
    );
  }
}

// Per scanner+plate interval analysis
console.log('\n--- Per-Plate Interval Between Cycles ---\n');
for (const key of Object.keys(groups).sort()) {
  const scans = groups[key];
  console.log(`${key} (${scans.length} cycles):`);

  for (let i = 0; i < scans.length; i++) {
    const s = scans[i];
    const scanDuration = s.endTime - s.startTime;
    let line = `  Cycle ${i + 1}: st_${s.stRaw} → et_${s.etRaw}  (scan: ${formatDuration(scanDuration)})`;

    if (i > 0) {
      const intervalFromStToSt = scans[i].startTime - scans[i - 1].startTime;
      const intervalFromEtToSt = scans[i].startTime - scans[i - 1].endTime;
      line += `  | interval: ${formatDuration(intervalFromStToSt)} (st→st), ${formatDuration(intervalFromEtToSt)} (et→st)`;
    }

    console.log(line);
  }
  console.log();
}

// Per-cycle total scan time (first grid start → last grid end)
console.log('--- Per-Cycle Total Scan Time ---\n');
// Identify cycles by sorting all unique st_ times and grouping grids
const allStarts = [...new Set(files.map((f) => f.startTime.getTime()))].sort(
  (a, b) => a - b
);
// Grids within a cycle have consecutive st_ times; cycles are separated by the interval gap
const cycles = [];
let currentCycle = [allStarts[0]];
for (let i = 1; i < allStarts.length; i++) {
  const gap = allStarts[i] - allStarts[i - 1];
  if (gap > 120000) {
    // >2min gap = new cycle
    cycles.push(currentCycle);
    currentCycle = [allStarts[i]];
  } else {
    currentCycle.push(allStarts[i]);
  }
}
cycles.push(currentCycle);

for (let i = 0; i < cycles.length; i++) {
  const cycleFiles = files.filter((f) =>
    cycles[i].includes(f.startTime.getTime())
  );
  const firstStart = new Date(
    Math.min(...cycleFiles.map((f) => f.startTime.getTime()))
  );
  const lastEnd = new Date(
    Math.max(...cycleFiles.map((f) => f.endTime.getTime()))
  );
  const totalMs = lastEnd - firstStart;
  const gridsInCycle = [...new Set(cycleFiles.map((f) => f.plate))].sort();
  console.log(
    `  Cycle ${i + 1}: ${firstStart.toISOString().slice(11, 19)} → ${lastEnd.toISOString().slice(11, 19)}  total: ${formatDuration(totalMs)}  (${gridsInCycle.length} grids)`
  );
}
console.log();

// Summary
console.log('--- Summary ---\n');
const allIntervals = [];
for (const scans of Object.values(groups)) {
  for (let i = 1; i < scans.length; i++) {
    allIntervals.push(scans[i].startTime - scans[i - 1].startTime);
  }
}
if (allIntervals.length > 0) {
  const avg = allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length;
  const min = Math.min(...allIntervals);
  const max = Math.max(...allIntervals);
  console.log(
    `  Intervals (st→st): avg=${formatDuration(avg)}, min=${formatDuration(min)}, max=${formatDuration(max)}`
  );
  console.log(
    `  Total scans: ${files.length} (${Object.keys(groups).length} plates × ${Math.round(files.length / Object.keys(groups).length)} cycles)`
  );
}
