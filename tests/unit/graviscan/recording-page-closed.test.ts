// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A continuous GraviScan session where the operator leaves the Capture
 * Scan page for part of it (#502). The main process records every image
 * through the real coordinator wiring, on a real database: each image gets
 * exactly one GraviScan row and one GraviImage row, page open or not.
 * Runs on a copy of the migrated template database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { TEMPLATE_DB_ABSOLUTE_PATH } from '../global-setup';

const OUTPUT_DIR = path.join(os.tmpdir(), 'bloom-gravi-page-closed-scans');

vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('../../../src/main/python-paths', () => ({
  getPythonExecutablePath: vi.fn().mockReturnValue('/usr/bin/python3'),
}));
vi.mock('../../../src/main/graviscan/scan-coordinator', () => ({
  ScanCoordinator: vi.fn().mockImplementation(() =>
    Object.assign(new EventEmitter(), {
      shutdown: vi.fn().mockResolvedValue(undefined),
      stopScanner: vi.fn().mockResolvedValue(undefined),
    })
  ),
}));
// Keeps the session records `initGraviScan` hands to the IPC handlers.
vi.mock('../../../src/main/graviscan/register-handlers', () => ({
  registerGraviScanHandlers: vi.fn(),
  _resetRegistration: vi.fn(),
}));
// Nothing here may touch the real ~/.bloom (scan log, output folder).
vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
  cleanupOldLogs: vi.fn(),
  closeScanLog: vi.fn(),
}));
vi.mock('../../../src/main/graviscan/image-handlers', () => ({
  getOutputDir: () => ({ success: true, path: OUTPUT_DIR }),
}));
vi.mock('../../../src/main/graviscan/scanner-port-audit', () => ({
  auditScannerPorts: vi.fn().mockResolvedValue([]),
}));

import {
  graviSessionFns,
  getOrCreateCoordinator,
  initGraviScan,
  _resetWiringState,
} from '../../../src/main/graviscan/wiring';
import { registerGraviScanHandlers } from '../../../src/main/graviscan/register-handlers';
import type { SessionRecords } from '../../../src/main/graviscan/session-records';
import type { ScanSessionState } from '../../../src/types/graviscan';

const privateDbPath =
  fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-gravi-page-closed-db-')) +
  path.sep +
  'dev.db';
fs.copyFileSync(TEMPLATE_DB_ABSOLUTE_PATH, privateDbPath);
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${privateDbPath}` } },
});

beforeAll(async () => {
  await prisma.$connect();
  await _resetWiringState();
});
afterAll(async () => {
  await _resetWiringState();
  await prisma.$disconnect();
  fs.rmSync(path.dirname(privateDbPath), { recursive: true, force: true });
});

const SESSION_DIR = path.join(OUTPUT_DIR, 'Exp_wave1_20260809T190946');
const PLATES = ['00', '01'];
const CYCLES = [1, 2, 3];
/** Every scanner's image of a row shares its `_st_`; `_et_` is per file. */
const savedFile = (cycle: number, plate: string, tag: string) =>
  path.join(
    SESSION_DIR,
    `Exp_wave1_st_20260809T19${cycle}000_et_20260809T19${cycle}1${tag.slice(-1)}0_cy${cycle}_${tag}_${plate}.tif`
  );
/** A grid row's shared times, as the coordinator's grid-complete sends them. */
const rowStart = (cycle: number) => `2026-08-09T19:${cycle}0:00.000Z`;
const rowEnd = (cycle: number) => `2026-08-09T19:${cycle}2:00.000Z`;

describe('a session with the scan page closed for part of it (#502)', () => {
  it('records every image exactly once, with its row times, whether the page was open or not', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr S', email: 's-closed@example.org' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'P', email: 'p-closed@example.org' },
    });
    const experiment = await prisma.experiment.create({
      data: { name: 'Exp', species: 'Alfalfa', scientist_id: scientist.id },
    });
    const scanners = [
      {
        tag: 'Sc1',
        row: await prisma.graviScanner.create({
          data: { name: 'epkowa:usb:001:005', usb_port: '1-1' },
        }),
      },
      {
        tag: 'Sc2',
        row: await prisma.graviScanner.create({
          data: { name: 'epkowa:usb:001:006', usb_port: '1-2' },
        }),
      },
    ];

    // The window exists only while the page is "open"; events sent while
    // it's closed reach nobody.
    const sent: string[] = [];
    const window = {
      isDestroyed: () => false,
      webContents: { send: (channel: string) => sent.push(channel) },
    };
    let pageOpen = true;
    await initGraviScan('graviscan', {} as any, prisma, () =>
      pageOpen ? (window as any) : null
    );
    const records = vi.mocked(registerGraviScanHandlers).mock
      .calls[0][6] as SessionRecords;
    const coordinator =
      (await getOrCreateCoordinator()) as unknown as EventEmitter;

    // What startScan does: open the session row, then hold the session.
    const opened = await records.hooks.openSessionRecord({
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      scanMode: 'continuous',
      intervalSeconds: 60,
      durationSeconds: 180,
      totalCycles: CYCLES.length,
    });
    if (!opened.ok) throw new Error(opened.error);
    const jobs: ScanSessionState['jobs'] = {};
    for (const { row: scanner } of scanners) {
      for (const plate of PLATES) {
        jobs[`${scanner.id}:${plate}`] = {
          scannerId: scanner.id,
          plateIndex: plate,
          outputPath: path.join(SESSION_DIR, `planned_${plate}.tif`),
          plantBarcode: null,
          transplantDate: null,
          customNote: null,
          gridMode: '2grid',
          status: 'pending',
        };
      }
    }
    const session: ScanSessionState = {
      isActive: true,
      isContinuous: true,
      experimentId: experiment.id,
      phenotyperId: phenotyper.id,
      resolution: 600,
      sessionId: opened.sessionId,
      jobs,
      currentCycle: 0,
      totalCycles: CYCLES.length,
      intervalMs: 60000,
      scanStartedAt: 0,
      scanEndedAt: null,
      scanDurationMs: 0,
      coordinatorState: 'scanning',
      nextScanAt: null,
      waveNumber: 1,
      isTest: false,
    };
    graviSessionFns.setScanSession(session);

    for (const cycle of CYCLES) {
      // The operator leaves the page during cycle 2 and comes back for 3.
      pageOpen = cycle !== 2;
      // Each plate position is one grid row, scanned by both scanners.
      for (const plate of PLATES) {
        for (const { row: scanner } of scanners) {
          coordinator.emit('scan-started', {
            scanner_id: scanner.id,
            plate_index: plate,
            cycle_number: cycle,
          });
        }
        for (const { row: scanner, tag } of scanners) {
          const event = {
            scanner_id: scanner.id,
            plate_index: plate,
            path: savedFile(cycle, plate, tag),
            achieved_resolution: 600,
          };
          coordinator.emit('scan-complete', event);
          // A redelivered event while the page is closed.
          if (cycle === 2) coordinator.emit('scan-complete', event);
        }
        coordinator.emit('grid-complete', {
          cycle,
          gridIndex: plate,
          scanStartedAt: rowStart(cycle),
          scanEndedAt: rowEnd(cycle),
        });
      }
    }

    // The session ends while the page is open again.
    graviSessionFns.setScanSession(null);
    await records.hooks.onSessionEnd(session, 'completed');

    const scans = await prisma.graviScan.findMany({
      where: { session_id: opened.sessionId },
      include: { images: true },
      orderBy: [
        { cycle_number: 'asc' },
        { plate_index: 'asc' },
        { path: 'asc' },
      ],
    });
    expect(scans.map((s) => [s.cycle_number, s.plate_index])).toEqual(
      CYCLES.flatMap((c) =>
        PLATES.flatMap((p) => [
          [c, p],
          [c, p],
        ])
      )
    );
    for (const s of scans) {
      // Both scanners' grids in a row share the row's start and end times;
      // each file keeps its own `_et_` save time in its name.
      expect(s.scan_started_at?.toISOString()).toBe(rowStart(s.cycle_number!));
      expect(s.scan_ended_at?.toISOString()).toBe(rowEnd(s.cycle_number!));
      expect(s.images).toHaveLength(1);
      expect(s.images[0]).toMatchObject({
        path: s.path,
        status: 'pending',
        box_status: 'pending',
      });
    }

    const sessionRow = await prisma.graviScanSession.findUnique({
      where: { id: opened.sessionId },
    });
    expect(sessionRow?.completed_at).toBeInstanceOf(Date);
    expect(sessionRow?.cancelled).toBe(false);

    // Last cycle's jobs are recorded, and no error went to the page.
    expect(
      Object.values(session.jobs).every((j) => j.status === 'recorded')
    ).toBe(true);
    expect(sent).not.toContain('graviscan:scan-error');
  });
});
