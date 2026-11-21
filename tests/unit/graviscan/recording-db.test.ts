// @vitest-environment node
/**
 * A GraviScan session recorded by the main process, on a real database:
 * every image gets one GraviScan row and one GraviImage row that Box
 * backup, Bloom upload and Download Wave all pick up. Runs on a copy of
 * the migrated template database (see scan-upload-all-db.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_DB_ABSOLUTE_PATH } from '../global-setup';

// The scan log lives under ~/.bloom; never write there from a test.
vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
}));

import { createGraviScanRecording } from '../../../src/main/graviscan/recording-wiring';
import type { ScanSessionState } from '../../../src/types/graviscan';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-gravi-recording-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});

const DIR = path.join(os.tmpdir(), 'scans', 'Exp_wave1_20260809T190946');
const file = (cycle: number, plate: string) =>
  path.join(
    DIR,
    `Exp_wave1_st_20260809T190946_et_20260809T19100${cycle}_cy${cycle}_Sc1_${plate}.tif`
  );

/** What Box backup selects (box-backup.ts runBoxBackup). */
const boxWhere = {
  deleted: false,
  images: { some: { box_status: { in: ['pending', 'failed'] } } },
};
/** What Bloom upload selects (graviscan-upload.ts uploadAllPendingScans). */
const bloomWhere = {
  deleted: false,
  images: { some: { status: { in: ['pending', 'failed'] } } },
};

describe('a session recorded by the main process', () => {
  it('gives every image one scan row and one image row that Box, Bloom and Download Wave pick up', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr S', email: 's-rec@example.org' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'P', email: 'p-rec@example.org' },
    });
    const experiment = await prisma.experiment.create({
      data: { name: 'Exp', species: 'Alfalfa', scientist_id: scientist.id },
    });
    const scanner = await prisma.graviScanner.create({
      data: { name: 'epkowa:usb:001:005', usb_port: '1-1' },
    });

    let session: ScanSessionState | null = null;
    const recording = createGraviScanRecording({
      db: prisma,
      getMainWindow: () => null,
      getScanSession: () => session,
      getOutputDir: () => path.dirname(DIR),
    });

    const opened = await recording.sessionRecords.hooks.openSessionRecord({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      scanMode: 'continuous',
      intervalSeconds: 60,
      durationSeconds: 120,
      totalCycles: 2,
    });
    expect(opened.ok).toBe(true);
    const sessionId = opened.ok ? opened.sessionId : '';

    const job = (plateIndex: string) => ({
      scannerId: scanner.id,
      plateIndex,
      outputPath: path.join(DIR, `planned_${plateIndex}.tif`),
      plantBarcode: null,
      transplantDate: '2026-08-01',
      customNote: 'note',
      gridMode: '2grid',
      status: 'pending' as const,
    });
    session = {
      isActive: true,
      isContinuous: true,
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      resolution: 600,
      sessionId,
      jobs: {
        [`${scanner.id}:00`]: job('00'),
        [`${scanner.id}:01`]: job('01'),
      },
      currentCycle: 2,
      totalCycles: 2,
      intervalMs: 60000,
      scanStartedAt: 0,
      scanEndedAt: null,
      scanDurationMs: 0,
      coordinatorState: 'scanning',
      nextScanAt: null,
      waveNumber: 1,
      isTest: false,
    };

    const event = (cycle: number, plate: string) => ({
      scanner_id: scanner.id,
      plate_index: plate,
      path: file(cycle, plate),
      achieved_resolution: 599,
    });
    // Plate 00's cycle-1 image arrives late, during cycle 2 (#503); plate
    // 01's cycle-2 event is delivered twice.
    void recording.recorder.record(event(1, '01'));
    void recording.recorder.record(event(2, '00'));
    void recording.recorder.record(event(1, '00'));
    void recording.recorder.record(event(2, '01'));
    void recording.recorder.record(event(2, '01'));

    const ended = session;
    session = null;
    await recording.sessionRecords.hooks.onSessionEnd(ended, 'completed');

    const row = await prisma.graviScanSession.findUnique({
      where: { id: sessionId },
    });
    expect(row?.completed_at).toBeInstanceOf(Date);
    expect(row?.cancelled).toBe(false);

    const scans = await prisma.graviScan.findMany({
      where: { session_id: sessionId },
      include: { images: true },
      orderBy: [{ plate_index: 'asc' }, { cycle_number: 'asc' }],
    });
    expect(scans.map((s) => [s.plate_index, s.cycle_number, s.path])).toEqual([
      ['00', 1, file(1, '00')],
      ['00', 2, file(2, '00')],
      ['01', 1, file(1, '01')],
      ['01', 2, file(2, '01')],
    ]);
    for (const s of scans) {
      expect(s).toMatchObject({
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        wave_number: 1,
        resolution: 599,
        grid_mode: '2grid',
        custom_note: 'note',
      });
      expect(s.transplant_date?.toISOString().slice(0, 10)).toBe('2026-08-01');
      expect(s.images).toHaveLength(1);
      expect(s.images[0]).toMatchObject({
        path: s.path,
        status: 'pending',
        box_status: 'pending',
      });
    }

    const ids = scans.map((s) => s.id).sort();
    const pick = async (where: object) =>
      (await prisma.graviScan.findMany({ where, select: { id: true } }))
        .map((s) => s.id)
        .filter((id) => ids.includes(id))
        .sort();
    expect(await pick(boxWhere)).toEqual(ids);
    expect(await pick(bloomWhere)).toEqual(ids);

    // Download Wave copies each scan's `images` for the wave.
    const wave = await prisma.graviScan.findMany({
      where: { experiment_id: experiment.id, wave_number: 1, deleted: false },
      include: { images: true },
    });
    expect(wave.flatMap((s) => s.images.map((i) => i.path)).sort()).toEqual(
      scans.map((s) => s.path).sort()
    );
  });

  it("records session A's late image under A after a test scan has started", async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr L', email: 's-late@example.org' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'L', email: 'p-late@example.org' },
    });
    const experiment = await prisma.experiment.create({
      data: { name: 'Exp', species: 'Alfalfa', scientist_id: scientist.id },
    });
    const scanner = await prisma.graviScanner.create({
      data: { name: 'epkowa:usb:001:007', usb_port: '1-3' },
    });

    let current: ScanSessionState | null = null;
    const recording = createGraviScanRecording({
      db: prisma,
      getMainWindow: () => null,
      getScanSession: () => current,
      getOutputDir: () => path.dirname(DIR),
    });
    const opened = await recording.sessionRecords.hooks.openSessionRecord({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      scanMode: 'single',
      intervalSeconds: null,
      durationSeconds: null,
      totalCycles: 1,
    });
    if (!opened.ok) throw new Error(opened.error);

    const job = (dir: string) => ({
      scannerId: scanner.id,
      plateIndex: '00',
      outputPath: path.join(dir, 'planned_00.tif'),
      plantBarcode: null,
      transplantDate: null,
      customNote: null,
      gridMode: '2grid',
      status: 'pending' as const,
    });
    const base = {
      isActive: true,
      isContinuous: false,
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      resolution: 600,
      currentCycle: 1,
      totalCycles: 1,
      intervalMs: 0,
      scanStartedAt: 0,
      scanEndedAt: null,
      scanDurationMs: 0,
      coordinatorState: 'scanning' as const,
      nextScanAt: null,
      waveNumber: 1,
    };
    const sessionA: ScanSessionState = {
      ...base,
      sessionId: opened.sessionId,
      isTest: false,
      jobs: { [`${scanner.id}:00`]: job(DIR) },
    };
    // Session A's row times out and A ends (cancelled) before its image arrives.
    current = null;
    await recording.sessionRecords.hooks.onSessionEnd(sessionA, 'cancelled');

    // The user then runs Test Scan, which uses its own `test/` folder.
    const testDir = path.join(path.dirname(DIR), 'test');
    const testScan: ScanSessionState = {
      ...base,
      sessionId: null,
      isTest: true,
      jobs: { [`${scanner.id}:00`]: job(testDir) },
    };
    // It ends, and a new test scan is running when A's image arrives.
    await recording.sessionRecords.hooks.onSessionEnd(testScan, 'completed');
    current = testScan;

    // A's late image finally arrives.
    await recording.recorder.record({
      scanner_id: scanner.id,
      plate_index: '00',
      path: file(1, '00'),
    });

    const rows = await prisma.graviScan.findMany({
      where: { session_id: opened.sessionId },
      include: { images: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe(file(1, '00'));
    expect(rows[0].images).toHaveLength(1);
    expect(testScan.jobs[`${scanner.id}:00`].imagePath).toBeUndefined();
  });
});
