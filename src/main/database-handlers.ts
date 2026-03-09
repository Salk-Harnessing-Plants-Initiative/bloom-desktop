/**
 * Database IPC Handlers
 *
 * Provides IPC handlers for database operations, exposing CRUD operations
 * for all models to the renderer process.
 */

import { ipcMain } from 'electron';
import { getDatabase } from './database';
import type { Prisma } from '@prisma/client';

/**
 * Standard response format for database operations
 */
interface DatabaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  total?: number;
}

/**
 * Log database operation for testing/debugging (dev mode only)
 * Format: [DB:OPERATION] Model: details
 */
function logDatabaseOperation(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'BROWSE',
  model: string,
  details: string
) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DB:${operation}] ${model}: ${details}`);
  }
}

/**
 * Register all database IPC handlers
 *
 * Handlers follow naming convention: db:{model}:{action}
 * All handlers return DatabaseResponse for consistent error handling
 */
export function registerDatabaseHandlers() {
  const db = getDatabase();

  // ============================================
  // Experiments
  // ============================================

  ipcMain.handle('db:experiments:list', async (): Promise<DatabaseResponse> => {
    try {
      const experiments = await db.experiment.findMany({
        include: {
          scientist: true,
          accession: true,
        },
        orderBy: { name: 'asc' },
      });
      return { success: true, data: experiments };
    } catch (error) {
      console.error('[DB] Failed to list experiments:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:experiments:create',
    async (
      _event,
      data: Prisma.ExperimentCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Experiment',
          `id=${experiment.id} name="${experiment.name}"`
        );
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to create experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:get',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.findUnique({
          where: { id },
          include: {
            scientist: true,
            accession: true,
            scans: {
              orderBy: { capture_date: 'desc' },
              take: 10, // Limit to recent 10 scans
            },
          },
        });
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to get experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:experiments:attachAccession',
    async (
      _event,
      experimentId: string,
      accessionId: string
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.update({
          where: { id: experimentId },
          data: { accession_id: accessionId },
          include: { accession: true },
        });
        logDatabaseOperation(
          'UPDATE',
          'Experiment',
          `id=${experimentId} attached accession=${accessionId}`
        );
        return { success: true, data: experiment };
      } catch (error) {
        console.error('[DB] Failed to attach accession to experiment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Phenotypers
  // ============================================

  ipcMain.handle('db:phenotypers:list', async (): Promise<DatabaseResponse> => {
    try {
      const phenotypers = await db.phenotyper.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: phenotypers };
    } catch (error) {
      console.error('[DB] Failed to list phenotypers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:phenotypers:create',
    async (
      _event,
      data: Prisma.PhenotyperCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const phenotyper = await db.phenotyper.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Phenotyper',
          `id=${phenotyper.id} name="${phenotyper.name}"`
        );
        return { success: true, data: phenotyper };
      } catch (error) {
        console.error('[DB] Failed to create phenotyper:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scientists
  // ============================================

  ipcMain.handle('db:scientists:list', async (): Promise<DatabaseResponse> => {
    try {
      const scientists = await db.scientist.findMany({
        orderBy: { name: 'asc' },
      });
      return { success: true, data: scientists };
    } catch (error) {
      console.error('[DB] Failed to list scientists:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:scientists:create',
    async (
      _event,
      data: Prisma.ScientistCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const scientist = await db.scientist.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Scientist',
          `id=${scientist.id} email="${scientist.email}"`
        );
        return { success: true, data: scientist };
      } catch (error) {
        console.error('[DB] Failed to create scientist:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Accessions
  // ============================================

  ipcMain.handle('db:accessions:list', async (): Promise<DatabaseResponse> => {
    try {
      const accessions = await db.accessions.findMany({
        include: {
          experiments: {
            select: {
              name: true,
            },
          },
          _count: {
            select: {
              mappings: true,
              graviPlateAccessions: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });
      return { success: true, data: accessions };
    } catch (error) {
      console.error('[DB] Failed to list accessions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(
    'db:accessions:create',
    async (
      _event,
      data: Prisma.AccessionsCreateInput
    ): Promise<DatabaseResponse> => {
      try {
        const accession = await db.accessions.create({ data });
        logDatabaseOperation(
          'CREATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );
        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to create accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:createWithMappings',
    async (
      _event,
      accessionData: { name: string },
      mappings: { plant_barcode: string; genotype_id?: string }[]
    ): Promise<DatabaseResponse> => {
      try {
        // Create accession with plant mappings in atomic transaction
        const result = await db.$transaction(async (tx) => {
          const accession = await tx.accessions.create({
            data: { name: accessionData.name },
          });

          // Process mappings in batches of 100
          const batchSize = 100;
          let totalCreated = 0;

          for (let i = 0; i < mappings.length; i += batchSize) {
            const batch = mappings.slice(i, i + batchSize);
            await tx.plantAccessionMappings.createMany({
              data: batch.map((m) => ({
                accession_file_id: accession.id,
                accession_id: accession.id,
                plant_barcode: m.plant_barcode,
                genotype_id: m.genotype_id ?? null,
              })),
            });
            totalCreated += batch.length;
          }

          return { accession, mappingCount: totalCreated };
        });

        logDatabaseOperation(
          'CREATE',
          'Accession with Mappings',
          `id=${result.accession.id} name="${result.accession.name}" mappings=${result.mappingCount}`
        );

        return {
          success: true,
          data: {
            ...result.accession,
            mappingCount: result.mappingCount,
          },
        };
      } catch (error) {
        console.error('[DB] Failed to create accession with mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getMappings',
    async (_event, accessionId: string): Promise<DatabaseResponse> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          orderBy: { plant_barcode: 'asc' },
        });
        return { success: true, data: mappings };
      } catch (error) {
        console.error('[DB] Failed to get accession mappings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:update',
    async (
      _event,
      id: string,
      data: { name: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.name || data.name.trim() === '') {
          return {
            success: false,
            error: 'Name cannot be empty',
          };
        }

        const accession = await db.accessions.update({
          where: { id },
          data: { name: data.name.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'Accession',
          `id=${accession.id} name="${accession.name}"`
        );

        return { success: true, data: accession };
      } catch (error) {
        console.error('[DB] Failed to update accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:delete',
    async (_event, id: string): Promise<DatabaseResponse> => {
      try {
        // Delete in transaction (cascade will handle plant mappings)
        const result = await db.$transaction(async (tx) => {
          // First delete all plant mappings
          await tx.plantAccessionMappings.deleteMany({
            where: { accession_file_id: id },
          });

          // Then delete the accession
          const accession = await tx.accessions.delete({
            where: { id },
          });

          return accession;
        });

        logDatabaseOperation('DELETE', 'Accession', `id=${id}`);

        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to delete accession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:updateMapping',
    async (
      _event,
      mappingId: string,
      data: { genotype_id: string }
    ): Promise<DatabaseResponse> => {
      try {
        if (!data.genotype_id || data.genotype_id.trim() === '') {
          return {
            success: false,
            error: 'Genotype ID cannot be empty',
          };
        }

        const mapping = await db.plantAccessionMappings.update({
          where: { id: mappingId },
          data: { genotype_id: data.genotype_id.trim() },
        });

        logDatabaseOperation(
          'UPDATE',
          'PlantAccessionMapping',
          `id=${mappingId} genotype_id="${data.genotype_id}"`
        );

        return { success: true, data: mapping };
      } catch (error) {
        console.error('[DB] Failed to update mapping:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getPlantBarcodes',
    async (
      _event,
      accessionId: string
    ): Promise<DatabaseResponse<string[]>> => {
      try {
        const mappings = await db.plantAccessionMappings.findMany({
          where: { accession_file_id: accessionId },
          select: { plant_barcode: true },
        });

        const barcodes = mappings.map((m) => m.plant_barcode);
        return { success: true, data: barcodes };
      } catch (error) {
        console.error('[DB] Failed to get plant barcodes:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:accessions:getGenotypeByBarcode',
    async (
      _event,
      plantBarcode: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        // First get the experiment to find its accession
        const experiment = await db.experiment.findUnique({
          where: { id: experimentId },
          select: { accession_id: true },
        });

        if (!experiment?.accession_id) {
          return { success: true, data: null };
        }

        // Find the mapping for this barcode in the experiment's accession
        const mapping = await db.plantAccessionMappings.findFirst({
          where: {
            accession_file_id: experiment.accession_id,
            plant_barcode: plantBarcode,
          },
          select: { genotype_id: true },
        });

        return { success: true, data: mapping?.genotype_id || null };
      } catch (error) {
        console.error('[DB] Failed to get genotype by barcode:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // GraviScan Plate Assignments
  // ============================================

  ipcMain.handle(
    'db:graviscanPlateAssignments:list',
    async (_event, experimentId: string, scannerId: string): Promise<DatabaseResponse> => {
      try {
        const assignments = await db.graviScanPlateAssignment.findMany({
          where: {
            experiment_id: experimentId,
            scanner_id: scannerId,
          },
          orderBy: { plate_index: 'asc' },
        });
        return { success: true, data: assignments };
      } catch (error) {
        console.error('[DB] Failed to list plate assignments:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviscanPlateAssignments:upsert',
    async (
      _event,
      experimentId: string,
      scannerId: string,
      plateIndex: string,
      data: { plant_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }
    ): Promise<DatabaseResponse> => {
      try {
        console.log('[DB:UPSERT] Attempting plate assignment upsert:', {
          experimentId,
          scannerId,
          plateIndex,
          data,
        });
        const assignment = await db.graviScanPlateAssignment.upsert({
          where: {
            experiment_id_scanner_id_plate_index: {
              experiment_id: experimentId,
              scanner_id: scannerId,
              plate_index: plateIndex,
            },
          },
          update: {
            plant_barcode: data.plant_barcode,
            transplant_date: data.transplant_date ? new Date(data.transplant_date) : data.transplant_date,
            custom_note: data.custom_note,
            selected: data.selected,
          },
          create: {
            experiment_id: experimentId,
            scanner_id: scannerId,
            plate_index: plateIndex,
            plant_barcode: data.plant_barcode ?? null,
            transplant_date: data.transplant_date ? new Date(data.transplant_date) : null,
            custom_note: data.custom_note ?? null,
            selected: data.selected ?? true,
          },
        });
        console.log('[DB:UPSERT] Plate assignment result:', JSON.stringify(assignment, null, 2));
        logDatabaseOperation(
          'UPDATE',
          'GraviScanPlateAssignment',
          `experiment=${experimentId} scanner=${scannerId} plate=${plateIndex} barcode=${data.plant_barcode || 'null'}`
        );
        return { success: true, data: assignment };
      } catch (error) {
        console.error('[DB] Failed to upsert plate assignment:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviscanPlateAssignments:upsertMany',
    async (
      _event,
      experimentId: string,
      scannerId: string,
      assignments: { plate_index: string; plant_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }[]
    ): Promise<DatabaseResponse> => {
      try {
        // Use transaction to upsert all assignments atomically
        const results = await db.$transaction(
          assignments.map((assignment) =>
            db.graviScanPlateAssignment.upsert({
              where: {
                experiment_id_scanner_id_plate_index: {
                  experiment_id: experimentId,
                  scanner_id: scannerId,
                  plate_index: assignment.plate_index,
                },
              },
              update: {
                plant_barcode: assignment.plant_barcode,
                transplant_date: assignment.transplant_date ? new Date(assignment.transplant_date) : assignment.transplant_date,
                custom_note: assignment.custom_note,
                selected: assignment.selected,
              },
              create: {
                experiment_id: experimentId,
                scanner_id: scannerId,
                plate_index: assignment.plate_index,
                plant_barcode: assignment.plant_barcode ?? null,
                transplant_date: assignment.transplant_date ? new Date(assignment.transplant_date) : null,
                custom_note: assignment.custom_note ?? null,
                selected: assignment.selected ?? true,
              },
            })
          )
        );
        logDatabaseOperation(
          'UPDATE',
          'GraviScanPlateAssignment',
          `experiment=${experimentId} scanner=${scannerId} count=${assignments.length}`
        );
        return { success: true, data: results };
      } catch (error) {
        console.error('[DB] Failed to upsert plate assignments:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Scans
  // ============================================

  ipcMain.handle(
    'db:scans:getMostRecentScanDate',
    async (
      _event,
      plantId: string,
      experimentId: string
    ): Promise<DatabaseResponse<string | null>> => {
      try {
        const scan = await db.scan.findFirst({
          where: {
            plant_id: plantId,
            experiment_id: experimentId,
            deleted: false,
          },
          orderBy: { capture_date: 'desc' },
          select: { capture_date: true },
        });

        return {
          success: true,
          data: scan?.capture_date?.toISOString() || null,
        };
      } catch (error) {
        console.error('[DB] Failed to get most recent scan date:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Images
  // ============================================

  // ============================================
  // GraviScan Records
  // ============================================

  ipcMain.handle(
    'db:graviscans:create',
    async (
      _event,
      data: {
        experiment_id: string;
        phenotyper_id: string;
        scanner_id: string;
        plant_barcode?: string | null;
        transplant_date?: string | null;
        custom_note?: string | null;
        path: string;
        grid_mode: string;
        plate_index: string;
        resolution: number;
        format?: string;
        session_id?: string | null;
        cycle_number?: number | null;
        wave_number?: number;
        scan_started_at?: string | null;
        scan_ended_at?: string | null;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const graviscan = await db.graviScan.create({
          data: {
            experiment_id: data.experiment_id,
            phenotyper_id: data.phenotyper_id,
            scanner_id: data.scanner_id,
            plant_barcode: data.plant_barcode ?? null,
            transplant_date: data.transplant_date ? new Date(data.transplant_date) : null,
            custom_note: data.custom_note ?? null,
            path: data.path,
            grid_mode: data.grid_mode,
            plate_index: data.plate_index,
            resolution: data.resolution,
            format: data.format ?? 'tiff',
            session_id: data.session_id ?? null,
            cycle_number: data.cycle_number ?? null,
            wave_number: data.wave_number ?? 0,
            scan_started_at: data.scan_started_at ? new Date(data.scan_started_at) : null,
            scan_ended_at: data.scan_ended_at ? new Date(data.scan_ended_at) : null,
          },
        });
        logDatabaseOperation(
          'CREATE',
          'GraviScan',
          `id=${graviscan.id} experiment=${data.experiment_id} scanner=${data.scanner_id} plate=${data.plate_index}`
        );
        return { success: true, data: graviscan };
      } catch (error) {
        console.error('[DB] Failed to create graviscan:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get max wave_number for an experiment (for auto-suggesting next wave)
  ipcMain.handle(
    'db:graviscans:get-max-wave-number',
    async (
      _event,
      experimentId: string
    ): Promise<DatabaseResponse> => {
      try {
        const result = await db.graviScan.aggregate({
          where: {
            experiment_id: experimentId,
            deleted: false,
          },
          _max: { wave_number: true },
        });
        const maxWave = result._max.wave_number ?? -1;
        return { success: true, data: maxWave };
      } catch (error) {
        console.error('[DB] Failed to get max wave number:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Check if a barcode already exists in a specific wave of an experiment
  ipcMain.handle(
    'db:graviscans:check-barcode-unique-in-wave',
    async (
      _event,
      data: {
        experiment_id: string;
        wave_number: number;
        plant_barcode: string;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const existing = await db.graviScan.findFirst({
          where: {
            experiment_id: data.experiment_id,
            wave_number: data.wave_number,
            plant_barcode: data.plant_barcode,
            deleted: false,
          },
          select: { id: true },
        });
        return {
          success: true,
          data: {
            isDuplicate: existing !== null,
            existingScanId: existing?.id,
          },
        };
      } catch (error) {
        console.error('[DB] Failed to check barcode uniqueness:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Update grid timestamps and renamed file paths for specific GraviScan records
  ipcMain.handle(
    'db:graviscans:update-grid-timestamps',
    async (
      _event,
      data: {
        ids: string[];
        scan_started_at: string;
        scan_ended_at: string;
        renamed_files?: { oldPath: string; newPath: string }[];
      }
    ): Promise<DatabaseResponse> => {
      try {
        // Update timestamps on all records in the grid
        const result = await db.graviScan.updateMany({
          where: {
            id: { in: data.ids },
          },
          data: {
            scan_started_at: new Date(data.scan_started_at),
            scan_ended_at: new Date(data.scan_ended_at),
          },
        });

        // Update paths for renamed files (old path → new path)
        if (data.renamed_files && data.renamed_files.length > 0) {
          for (const rf of data.renamed_files) {
            await db.graviScan.updateMany({
              where: {
                id: { in: data.ids },
                path: rf.oldPath,
              },
              data: { path: rf.newPath },
            });
            // Also update the associated GraviImage path
            await db.graviImage.updateMany({
              where: { path: rf.oldPath },
              data: { path: rf.newPath },
            });
          }
        }

        logDatabaseOperation(
          'UPDATE',
          'GraviScan',
          `Updated ${result.count} records with grid timestamps${data.renamed_files?.length ? ` and ${data.renamed_files.length} renamed paths` : ''}`
        );
        return { success: true, data: { count: result.count } };
      } catch (error) {
        console.error('[DB] Failed to update grid timestamps:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Browse experiments with their GraviScans (experiment-based pagination)
  ipcMain.handle(
    'db:graviscans:browse-by-experiment',
    async (
      _event,
      params: {
        offset?: number;
        limit?: number;
        filters?: {
          dateFrom?: string;
          dateTo?: string;
          experimentName?: string;
          accession?: string;
          uploadStatus?: string;
        };
      }
    ): Promise<DatabaseResponse> => {
      try {
        const offset = params.offset ?? 0;
        const limit = params.limit ?? 20;
        const filters = params.filters ?? {};

        // Build experiment-level where clause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expWhere: any = {
          graviscanScans: { some: { deleted: false } },
        };

        if (filters.experimentName) {
          expWhere.name = { contains: filters.experimentName };
        }

        if (filters.accession) {
          expWhere.accession = { name: { contains: filters.accession } };
        }

        // Date filter: experiments that have scans within the date range
        if (filters.dateFrom || filters.dateTo) {
          const dateFilter: Record<string, Date> = {};
          if (filters.dateFrom) dateFilter.gte = new Date(filters.dateFrom);
          if (filters.dateTo) {
            // Include the entire "to" day
            const toDate = new Date(filters.dateTo);
            toDate.setHours(23, 59, 59, 999);
            dateFilter.lte = toDate;
          }
          expWhere.graviscanScans.some.capture_date = dateFilter;
        }

        // Count for pagination
        const total = await db.experiment.count({ where: expWhere });

        // Fetch paginated experiments with their scans
        const experiments = await db.experiment.findMany({
          where: expWhere,
          include: {
            scientist: true,
            accession: true,
            graviscanScans: {
              where: { deleted: false },
              include: {
                phenotyper: true,
                scanner: true,
                images: true,
                session: true,
              },
              orderBy: { capture_date: 'desc' },
            },
          },
          orderBy: { name: 'asc' },
          skip: offset,
          take: limit,
        });

        // Transform to expected shape
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = experiments.map((exp: any) => ({
          id: exp.id,
          name: exp.name,
          species: exp.species,
          scientist: exp.scientist,
          accession: exp.accession,
          scans: exp.graviscanScans.map((scan: any) => ({
            ...scan,
            experiment: {
              id: exp.id,
              name: exp.name,
              species: exp.species,
              experiment_type: exp.experiment_type,
              scientist: exp.scientist,
            },
          })),
        }));

        // Post-filter by upload status if specified
        let filtered = results;
        if (filters.uploadStatus) {
          filtered = results.filter((exp: any) => {
            // Aggregate all images across all scans in this experiment
            const allImages = exp.scans.flatMap((s: any) => s.images || []);
            if (allImages.length === 0) return filters.uploadStatus === 'pending';
            const statuses = allImages.map((img: any) => img.status);
            if (filters.uploadStatus === 'uploaded') return statuses.every((s: string) => s === 'uploaded');
            if (filters.uploadStatus === 'failed') return statuses.some((s: string) => s === 'failed');
            if (filters.uploadStatus === 'pending') return statuses.every((s: string) => s === 'pending');
            return true;
          });
        }

        logDatabaseOperation('BROWSE', 'Experiment+GraviScan', `offset=${offset} limit=${limit} total=${total} returned=${filtered.length}`);
        return { success: true, data: filtered, total };
      } catch (error) {
        console.error('[DB] Failed to browse experiments with scans:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // Experiment Detail (single experiment with all scans/images)
  // ============================================

  ipcMain.handle(
    'db:graviscans:experiment-detail',
    async (
      _event,
      params: { experimentId: string }
    ): Promise<DatabaseResponse> => {
      try {
        const experiment = await db.experiment.findUnique({
          where: { id: params.experimentId },
          include: {
            scientist: true,
            accession: true,
            graviscanScans: {
              where: { deleted: false },
              include: {
                phenotyper: true,
                scanner: true,
                images: true,
                session: true,
              },
              orderBy: [
                { cycle_number: 'asc' },
                { scanner_id: 'asc' },
                { plate_index: 'asc' },
              ],
            },
          },
        });

        if (!experiment) {
          return { success: false, error: 'Experiment not found' };
        }

        // Transform to expected shape
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = {
          id: experiment.id,
          name: experiment.name,
          species: experiment.species,
          scientist: experiment.scientist,
          accession: experiment.accession,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          scans: experiment.graviscanScans.map((scan: any) => ({
            ...scan,
            experiment: {
              id: experiment.id,
              name: experiment.name,
              species: experiment.species,
              experiment_type: experiment.experiment_type,
              scientist: experiment.scientist,
            },
          })),
        };

        logDatabaseOperation('READ', 'Experiment+GraviScan', `experimentId=${params.experimentId} scans=${result.scans.length}`);
        return { success: true, data: result };
      } catch (error) {
        console.error('[DB] Failed to get experiment detail:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // ============================================
  // GraviImage Records
  // ============================================

  ipcMain.handle(
    'db:graviimages:create',
    async (
      _event,
      data: {
        graviscan_id: string;
        path: string;
        status?: string;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const graviimage = await db.graviImage.create({
          data: {
            graviscan_id: data.graviscan_id,
            path: data.path,
            status: data.status ?? 'pending',
          },
        });
        logDatabaseOperation(
          'CREATE',
          'GraviImage',
          `id=${graviimage.id} graviscan=${data.graviscan_id} path=${data.path}`
        );
        return { success: true, data: graviimage };
      } catch (error) {
        console.error('[DB] Failed to create graviimage:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // =========================================================================
  // GraviScanSession
  // =========================================================================

  ipcMain.handle(
    'db:graviscan-sessions:create',
    async (
      _event,
      data: {
        experiment_id: string;
        phenotyper_id: string;
        scan_mode: string;
        interval_seconds?: number | null;
        duration_seconds?: number | null;
        total_cycles?: number | null;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const session = await db.graviScanSession.create({
          data: {
            experiment_id: data.experiment_id,
            phenotyper_id: data.phenotyper_id,
            scan_mode: data.scan_mode,
            interval_seconds: data.interval_seconds ?? null,
            duration_seconds: data.duration_seconds ?? null,
            total_cycles: data.total_cycles ?? null,
          },
        });
        logDatabaseOperation(
          'CREATE',
          'GraviScanSession',
          `id=${session.id} mode=${data.scan_mode} experiment=${data.experiment_id}`
        );
        return { success: true, data: session };
      } catch (error) {
        console.error('[DB] Failed to create GraviScanSession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviscan-sessions:complete',
    async (
      _event,
      data: {
        session_id: string;
        cancelled?: boolean;
      }
    ): Promise<DatabaseResponse> => {
      try {
        const session = await db.graviScanSession.update({
          where: { id: data.session_id },
          data: {
            completed_at: new Date(),
            cancelled: data.cancelled ?? false,
          },
        });
        logDatabaseOperation(
          'UPDATE',
          'GraviScanSession',
          `id=${session.id} completed cancelled=${data.cancelled ?? false}`
        );
        return { success: true, data: session };
      } catch (error) {
        console.error('[DB] Failed to complete GraviScanSession:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // =========================================================================
  // GraviScan Metadata (GraviPlateAccession + GraviPlateSectionMapping)
  // =========================================================================

  ipcMain.handle(
    'db:graviPlateAccessions:createWithSections',
    async (
      _event,
      accessionData: { name: string },
      plates: {
        plate_id: string;
        accession: string;
        transplant_date?: string | null;
        custom_note?: string | null;
        sections: {
          plate_section_id: string;
          plant_qr: string;
          medium?: string | null;
        }[];
      }[]
    ): Promise<DatabaseResponse> => {
      try {
        const result = await db.$transaction(async (tx) => {
          // Create parent Accessions record
          const metadataFile = await tx.accessions.create({
            data: { name: accessionData.name },
          });

          let totalPlates = 0;
          let totalSections = 0;

          for (const plate of plates) {
            const plateRecord = await tx.graviPlateAccession.create({
              data: {
                metadata_file_id: metadataFile.id,
                plate_id: plate.plate_id,
                accession: plate.accession,
                transplant_date: plate.transplant_date ? new Date(plate.transplant_date) : null,
                custom_note: plate.custom_note ?? null,
              },
            });
            totalPlates++;

            if (plate.sections.length > 0) {
              await tx.graviPlateSectionMapping.createMany({
                data: plate.sections.map((s) => ({
                  gravi_plate_id: plateRecord.id,
                  plate_section_id: s.plate_section_id,
                  plant_qr: s.plant_qr,
                  medium: s.medium ?? null,
                })),
              });
              totalSections += plate.sections.length;
            }
          }

          return { metadataFile, totalPlates, totalSections };
        });

        logDatabaseOperation(
          'CREATE',
          'GraviPlateAccession+Sections',
          `file_id=${result.metadataFile.id} name="${accessionData.name}" plates=${result.totalPlates} sections=${result.totalSections}`
        );

        return {
          success: true,
          data: {
            ...result.metadataFile,
            totalPlates: result.totalPlates,
            totalSections: result.totalSections,
          },
        };
      } catch (error) {
        console.error(
          '[DB] Failed to create gravi plate accessions:',
          error
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviPlateAccessions:list',
    async (
      _event,
      metadataFileId: string
    ): Promise<DatabaseResponse> => {
      try {
        const plates = await db.graviPlateAccession.findMany({
          where: { metadata_file_id: metadataFileId },
          include: {
            sections: {
              orderBy: { plate_section_id: 'asc' },
            },
          },
          orderBy: { plate_id: 'asc' },
        });
        return { success: true, data: plates };
      } catch (error) {
        console.error('[DB] Failed to list gravi plate accessions:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviPlateAccessions:listFiles',
    async (): Promise<DatabaseResponse> => {
      try {
        // List Accessions records that have GraviPlateAccession children
        const files = await db.accessions.findMany({
          where: {
            graviPlateAccessions: {
              some: {},
            },
          },
          include: {
            experiments: {
              select: { name: true },
            },
            _count: {
              select: { graviPlateAccessions: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        return { success: true, data: files };
      } catch (error) {
        console.error('[DB] Failed to list gravi metadata files:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  ipcMain.handle(
    'db:graviPlateAccessions:delete',
    async (_event, metadataFileId: string): Promise<DatabaseResponse> => {
      try {
        await db.$transaction(async (tx) => {
          // Get all plate accession IDs for this file
          const plates = await tx.graviPlateAccession.findMany({
            where: { metadata_file_id: metadataFileId },
            select: { id: true },
          });

          // Delete section mappings
          await tx.graviPlateSectionMapping.deleteMany({
            where: {
              gravi_plate_id: { in: plates.map((p) => p.id) },
            },
          });

          // Delete plate accessions
          await tx.graviPlateAccession.deleteMany({
            where: { metadata_file_id: metadataFileId },
          });

          // Delete the parent Accessions record
          await tx.accessions.delete({
            where: { id: metadataFileId },
          });
        });

        logDatabaseOperation(
          'DELETE',
          'GraviPlateAccession+Sections',
          `metadata_file_id=${metadataFileId}`
        );

        return { success: true };
      } catch (error) {
        console.error(
          '[DB] Failed to delete gravi plate accessions:',
          error
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  console.log('[DB] Registered all database IPC handlers');
}
